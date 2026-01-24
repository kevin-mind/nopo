/**
 * Main test runner orchestration
 *
 * Polls for state changes, predicts transitions, and diagnoses failures
 */

import * as core from "@actions/core";
import type {
  GitHubState,
  PhaseResult,
  RunnerConfig,
  TestResult,
} from "./types.js";
import { pollUntil, DEFAULT_POLLER_CONFIG } from "./poller.js";
import { predictNextState, isTerminalState } from "./predictor.js";
import { diagnoseFailure, formatDiagnosis } from "./diagnostics.js";
import {
  fetchGitHubState,
  fetchRecentWorkflowRuns,
  buildContextFromState,
  simulateMerge,
} from "./github-state.js";

/**
 * Check if state matches expected status
 */
function stateMatchesExpected(
  state: GitHubState,
  expectedStatus: string | null,
): boolean {
  if (!expectedStatus) {
    return false;
  }
  return state.projectStatus === expectedStatus;
}

/**
 * Run the test for a single issue
 */
export async function runTest(config: RunnerConfig): Promise<TestResult> {
  const {
    fixture,
    issueNumber,
    projectNumber,
    octokit,
    owner,
    repo,
    botUsername = "nopo-bot",
    maxRetries: _maxRetries = 5,
  } = config;

  // Keep reference to avoid lint error
  void _maxRetries;

  const phases: PhaseResult[] = [];
  const startTime = Date.now();
  const timeoutMs = (fixture.timeout ?? 300) * 1000;

  core.info(`Starting test run for issue #${issueNumber}`);
  core.info(`Timeout: ${timeoutMs / 1000} seconds`);

  // Main polling loop
  let iterationCount = 0;
  const maxIterations = 100; // Safety limit

  while (iterationCount < maxIterations) {
    iterationCount++;
    const phaseStartTime = Date.now();

    // 1. Fetch current GitHub state
    core.info(`\n=== Iteration ${iterationCount} ===`);
    const githubState = await fetchGitHubState(
      octokit,
      owner,
      repo,
      issueNumber,
      projectNumber,
      botUsername,
    );

    core.info(`Current status: ${githubState.projectStatus || "unknown"}`);
    core.info(
      `Iteration: ${githubState.iteration}, Failures: ${githubState.failures}`,
    );
    core.info(`Bot assigned: ${githubState.botAssigned}`);
    core.info(
      `PR: ${githubState.prNumber ? `#${githubState.prNumber} (${githubState.prState})` : "none"}`,
    );
    if (githubState.prLabels.length > 0) {
      core.info(`PR labels: ${githubState.prLabels.join(", ")}`);
    }

    // Check for "ready-to-merge" label and simulate human merge action
    if (
      githubState.prNumber &&
      githubState.prState === "OPEN" &&
      githubState.prLabels.includes("ready-to-merge")
    ) {
      core.info(
        `PR #${githubState.prNumber} has "ready-to-merge" label - simulating human merge action`,
      );
      const merged = await simulateMerge(
        octokit,
        owner,
        repo,
        githubState.prNumber,
      );
      if (merged) {
        core.info(`Merge initiated for PR #${githubState.prNumber}`);
        // Wait a moment for the merge to complete
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // Continue to next iteration to check the new state
        continue;
      } else {
        core.warning(`Failed to merge PR #${githubState.prNumber}`);
      }
    }

    // 2. Check terminal conditions
    if (githubState.projectStatus === "Done") {
      core.info("Issue reached Done status - test complete!");
      return {
        status: "done",
        phases,
        totalDurationMs: Date.now() - startTime,
        issueNumber,
      };
    }

    if (githubState.projectStatus === "Blocked") {
      const workflowRuns = await fetchRecentWorkflowRuns(
        octokit,
        owner,
        repo,
        issueNumber,
      );
      const context = buildContextFromState(githubState, owner, repo);
      const predicted = predictNextState(context);
      const diagnosis = diagnoseFailure(predicted, githubState, workflowRuns);

      core.warning("Issue is blocked - circuit breaker triggered");
      core.warning(formatDiagnosis(diagnosis));

      return {
        status: "error",
        suggestedFix: diagnosis.suggestedFix,
        diagnosis: diagnosis.diagnosis,
        phases,
        totalDurationMs: Date.now() - startTime,
        issueNumber,
      };
    }

    // 3. Build context and predict next state
    const context = buildContextFromState(githubState, owner, repo);
    const predicted = predictNextState(context);

    core.info(`Predicted state: ${predicted.expectedState}`);
    core.info(`Expected status: ${predicted.expectedStatus || "unchanged"}`);
    core.info(`Description: ${predicted.description}`);

    if (predicted.triggersNeeded.length > 0) {
      core.info(`Waiting for triggers: ${predicted.triggersNeeded.join(", ")}`);
    }

    // 4. If we've reached expected status, check if there's more to do
    if (
      predicted.expectedStatus &&
      stateMatchesExpected(githubState, predicted.expectedStatus)
    ) {
      // Check if this is a terminal state
      if (isTerminalState(predicted.expectedState)) {
        core.info(`Reached terminal state: ${predicted.expectedState}`);
        phases.push({
          phase: iterationCount,
          startState: githubState.projectStatus || "unknown",
          endState: predicted.expectedState,
          success: true,
          durationMs: Date.now() - phaseStartTime,
        });

        if (predicted.expectedState === "done") {
          return {
            status: "done",
            phases,
            totalDurationMs: Date.now() - startTime,
            issueNumber,
          };
        }
      }
    }

    // 5. Poll until state changes or timeout
    const remainingTime = timeoutMs - (Date.now() - startTime);
    if (remainingTime <= 0) {
      core.warning("Overall timeout reached");
      break;
    }

    core.info(
      `Polling for state change (max ${Math.round(remainingTime / 1000)}s)...`,
    );

    const pollResult = await pollUntil(
      () =>
        fetchGitHubState(
          octokit,
          owner,
          repo,
          issueNumber,
          projectNumber,
          botUsername,
        ),
      (state) => {
        // Check for any status change
        if (state.projectStatus !== githubState.projectStatus) {
          return true;
        }
        // Check for iteration increment
        if (state.iteration > githubState.iteration) {
          return true;
        }
        // Check for PR state change
        if (state.prState !== githubState.prState) {
          return true;
        }
        // Check for terminal states
        if (
          state.projectStatus === "Done" ||
          state.projectStatus === "Blocked"
        ) {
          return true;
        }
        return false;
      },
      {
        ...DEFAULT_POLLER_CONFIG,
        timeoutMs: Math.min(remainingTime, predicted.estimatedWaitMs * 2),
      },
      (state, attempt, elapsed) => {
        core.debug(
          `Poll attempt ${attempt} (${Math.round(elapsed / 1000)}s): status=${state.projectStatus}, iteration=${state.iteration}`,
        );
      },
    );

    if (pollResult.success && pollResult.data) {
      const newState = pollResult.data;
      core.info(
        `State changed: ${githubState.projectStatus} -> ${newState.projectStatus}`,
      );

      phases.push({
        phase: iterationCount,
        startState: githubState.projectStatus || "unknown",
        endState: newState.projectStatus || "unknown",
        success: true,
        durationMs: Date.now() - phaseStartTime,
      });

      // Continue polling with new state
      continue;
    }

    // 6. Poll timed out - diagnose and return
    core.warning(`Poll timed out after ${pollResult.attempts} attempts`);

    const workflowRuns = await fetchRecentWorkflowRuns(
      octokit,
      owner,
      repo,
      issueNumber,
    );

    const diagnosis = diagnoseFailure(predicted, githubState, workflowRuns);
    core.warning(formatDiagnosis(diagnosis));

    // Record the failed phase
    phases.push({
      phase: iterationCount,
      startState: githubState.projectStatus || "unknown",
      endState: githubState.projectStatus || "unknown",
      success: false,
      error: diagnosis.diagnosis,
      durationMs: Date.now() - phaseStartTime,
    });

    return {
      status: diagnosis.status,
      suggestedFix: diagnosis.suggestedFix,
      diagnosis: diagnosis.diagnosis,
      phases,
      totalDurationMs: Date.now() - startTime,
      issueNumber,
    };
  }

  // Exceeded max iterations
  return {
    status: "timeout",
    suggestedFix: "Test exceeded maximum iterations - check for infinite loops",
    diagnosis: `Exceeded ${maxIterations} iterations without reaching terminal state`,
    phases,
    totalDurationMs: Date.now() - startTime,
    issueNumber,
  };
}

/**
 * Run diagnostic analysis without waiting
 *
 * Useful for quick status checks
 */
export async function diagnose(config: RunnerConfig): Promise<TestResult> {
  const {
    issueNumber,
    projectNumber,
    octokit,
    owner,
    repo,
    botUsername = "nopo-bot",
  } = config;

  const startTime = Date.now();

  // Fetch current state
  const githubState = await fetchGitHubState(
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
    botUsername,
  );

  // Get workflow runs
  const workflowRuns = await fetchRecentWorkflowRuns(
    octokit,
    owner,
    repo,
    issueNumber,
  );

  // Build context and predict
  const context = buildContextFromState(githubState, owner, repo);
  const predicted = predictNextState(context);

  // Diagnose
  const diagnosis = diagnoseFailure(predicted, githubState, workflowRuns);

  return {
    status: diagnosis.status,
    suggestedFix: diagnosis.suggestedFix,
    diagnosis: diagnosis.diagnosis,
    phases: [],
    totalDurationMs: Date.now() - startTime,
    issueNumber,
  };
}

/**
 * Wait for a specific status and then return
 */
export async function waitForStatus(
  config: RunnerConfig,
  targetStatus: string,
): Promise<TestResult> {
  const {
    fixture,
    issueNumber,
    projectNumber,
    octokit,
    owner,
    repo,
    botUsername = "nopo-bot",
  } = config;

  const startTime = Date.now();
  const timeoutMs = (fixture.timeout ?? 300) * 1000;

  core.info(
    `Waiting for issue #${issueNumber} to reach status: ${targetStatus}`,
  );

  const pollResult = await pollUntil(
    () =>
      fetchGitHubState(
        octokit,
        owner,
        repo,
        issueNumber,
        projectNumber,
        botUsername,
      ),
    (state) => state.projectStatus === targetStatus,
    {
      ...DEFAULT_POLLER_CONFIG,
      timeoutMs,
    },
    (state, attempt, elapsed) => {
      core.info(
        `Poll ${attempt} (${Math.round(elapsed / 1000)}s): status=${state.projectStatus}`,
      );
    },
  );

  if (pollResult.success) {
    return {
      status: "done",
      phases: [],
      totalDurationMs: Date.now() - startTime,
      issueNumber,
    };
  }

  // Diagnose failure
  const githubState = pollResult.data;
  if (!githubState) {
    return {
      status: "error",
      suggestedFix: "Could not fetch issue state",
      diagnosis: "Failed to fetch issue state from GitHub",
      phases: [],
      totalDurationMs: Date.now() - startTime,
      issueNumber,
    };
  }

  const workflowRuns = await fetchRecentWorkflowRuns(
    octokit,
    owner,
    repo,
    issueNumber,
  );

  const context = buildContextFromState(githubState, owner, repo);
  const predicted = predictNextState(context);
  const diagnosis = diagnoseFailure(predicted, githubState, workflowRuns);

  return {
    status: diagnosis.status,
    suggestedFix: diagnosis.suggestedFix,
    diagnosis: diagnosis.diagnosis,
    phases: [],
    totalDurationMs: Date.now() - startTime,
    issueNumber,
  };
}
