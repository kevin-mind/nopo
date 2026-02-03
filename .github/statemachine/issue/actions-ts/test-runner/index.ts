/**
 * Claude Test Runner - Intelligent E2E test runner for Claude state machine
 *
 * Features:
 * - State prediction via XState machine
 * - Exponential backoff polling
 * - Self-healing diagnostics with actionable fixes
 * - Automatic cleanup on failure
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../../../shared/lib/index.js";
import type { TestFixture } from "./src/types.js";
import { runTest, diagnose, waitForStatus } from "./src/runner.js";
import { validateFixture, formatValidationResult } from "./src/validate.js";
import {
  fetchGitHubState,
  fetchRecentWorkflowRuns,
  buildContextFromState,
} from "./src/github-state.js";
import { predictNextState } from "./src/predictor.js";
import { waitForTriage } from "./src/triage.js";
import { waitForPhase } from "./src/phase.js";
import { setupCancellationHandlers } from "./src/poller.js";
import {
  loadScenario,
  runConfigurableTest,
  type TestRunnerInputs,
  loadDiscussionScenario,
  runDiscussionConfigurableTest,
  type DiscussionTestRunnerInputs,
} from "./src/configurable/index.js";

/**
 * Trigger cleanup for an issue when test fails
 */
async function triggerCleanup(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  core.info(`Triggering cleanup for issue #${issueNumber}`);

  try {
    // Use the test-helper action's cleanup functionality via workflow dispatch
    // This will close the issue and all sub-issues, and set project status to Done
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "_test_cleanup.yml",
      ref: "main",
      inputs: {
        issue_number: String(issueNumber),
        action: "cleanup",
      },
    });
    core.info("Cleanup workflow triggered");
  } catch (error) {
    // If cleanup workflow doesn't exist, try direct close via API
    core.warning(`Could not trigger cleanup workflow: ${error}`);
    core.info("Attempting direct close via API...");

    try {
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: "closed",
        state_reason: "not_planned",
      });
      core.info(`Closed issue #${issueNumber} directly`);
    } catch (closeError) {
      core.warning(`Failed to close issue: ${closeError}`);
    }
  }
}

async function run(): Promise<void> {
  // Setup signal handlers for graceful cancellation
  setupCancellationHandlers();

  try {
    const action = getRequiredInput("action");
    const token = getRequiredInput("github_token");
    const projectNumber = parseInt(
      getOptionalInput("project_number") || "1",
      10,
    );
    const cleanupOnFailure = getOptionalInput("cleanup_on_failure") === "true";

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Run action
    if (action === "run") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
      const fixtureJson = getOptionalInput("fixture_json");

      const fixture: TestFixture = fixtureJson
        ? JSON.parse(fixtureJson)
        : { name: "manual", description: "Manual test run" };

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: run`);
      core.info(`Issue: #${issueNumber}`);
      core.info(`Fixture: ${fixture.name}`);

      const result = await runTest({
        fixture,
        issueNumber,
        projectNumber,
        octokit,
        owner,
        repo,
      });

      // Set outputs
      setOutputs({
        status: result.status,
        suggested_fix: result.suggestedFix || "",
        diagnosis: result.diagnosis || "",
        phases_completed: String(result.phases.filter((p) => p.success).length),
        total_duration_ms: String(result.totalDurationMs),
      });

      // Handle failure
      if (result.status !== "done") {
        core.warning(`Test failed: ${result.diagnosis}`);
        core.warning(`Suggested fix: ${result.suggestedFix}`);

        // Trigger cleanup if enabled
        if (cleanupOnFailure) {
          await triggerCleanup(octokit, owner, repo, issueNumber);
        }

        core.setFailed(`Test failed: ${result.diagnosis}`);
      } else {
        core.info(`Test passed! Completed ${result.phases.length} phases`);
      }

      return;
    }

    // Diagnose action
    if (action === "diagnose") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
      const fixtureJson = getOptionalInput("fixture_json");

      const fixture: TestFixture = fixtureJson
        ? JSON.parse(fixtureJson)
        : { name: "manual", description: "Manual diagnosis" };

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: diagnose`);
      core.info(`Issue: #${issueNumber}`);

      const result = await diagnose({
        fixture,
        issueNumber,
        projectNumber,
        octokit,
        owner,
        repo,
      });

      setOutputs({
        status: result.status,
        suggested_fix: result.suggestedFix || "",
        diagnosis: result.diagnosis || "",
        phases_completed: "0",
        total_duration_ms: String(result.totalDurationMs),
      });

      core.info(`\nDiagnosis Result:`);
      core.info(`Status: ${result.status}`);
      if (result.suggestedFix) {
        core.info(`Suggested Fix: ${result.suggestedFix}`);
      }
      if (result.diagnosis) {
        core.info(`Diagnosis: ${result.diagnosis}`);
      }

      return;
    }

    // Wait action
    if (action === "wait") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
      const targetStatus = getRequiredInput("target_status");
      const fixtureJson = getOptionalInput("fixture_json");

      const fixture: TestFixture = fixtureJson
        ? JSON.parse(fixtureJson)
        : {
            name: "wait",
            description: "Wait for status",
            timeout: parseInt(getOptionalInput("timeout") || "300", 10),
          };

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: wait`);
      core.info(`Issue: #${issueNumber}`);
      core.info(`Target Status: ${targetStatus}`);

      const result = await waitForStatus(
        {
          fixture,
          issueNumber,
          projectNumber,
          octokit,
          owner,
          repo,
        },
        targetStatus,
      );

      setOutputs({
        status: result.status,
        suggested_fix: result.suggestedFix || "",
        diagnosis: result.diagnosis || "",
        phases_completed: "0",
        total_duration_ms: String(result.totalDurationMs),
      });

      if (result.status !== "done") {
        if (cleanupOnFailure) {
          await triggerCleanup(octokit, owner, repo, issueNumber);
        }
        core.setFailed(
          `Failed to reach status '${targetStatus}': ${result.diagnosis}`,
        );
      } else {
        core.info(`Issue reached status '${targetStatus}'`);
      }

      return;
    }

    // Wait-triage action - wait for triage to complete and verify
    if (action === "wait-triage") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
      const fixtureJson = getOptionalInput("fixture_json");
      const timeoutMs =
        parseInt(getOptionalInput("timeout") || "300", 10) * 1000;
      const pollIntervalMs =
        parseInt(getOptionalInput("poll_interval") || "10", 10) * 1000;

      const fixture: TestFixture = fixtureJson
        ? JSON.parse(fixtureJson)
        : { name: "wait-triage", description: "Wait for triage" };

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: wait-triage`);
      core.info(`Issue: #${issueNumber}`);

      const result = await waitForTriage({
        octokit,
        owner,
        repo,
        issueNumber,
        projectNumber,
        timeoutMs,
        pollIntervalMs,
        expectations: fixture.expected?.triage,
      });

      setOutputs({
        success: String(result.success),
        labels: JSON.stringify(result.labels),
        project_fields: JSON.stringify(result.project_fields),
        sub_issue_count: String(result.sub_issue_count),
        errors: result.errors.join("; "),
        total_duration_ms: String(result.duration_ms),
      });

      if (!result.success) {
        if (cleanupOnFailure) {
          await triggerCleanup(octokit, owner, repo, issueNumber);
        }
        core.setFailed(
          `Triage verification failed: ${result.errors.join("; ")}`,
        );
      } else {
        core.info("Triage completed and verified successfully");
      }

      return;
    }

    // Wait-phase action - wait for development phase to complete
    if (action === "wait-phase") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
      const phaseNumber = parseInt(getOptionalInput("phase_number") || "1", 10);
      const fixtureJson = getOptionalInput("fixture_json");
      const timeoutMs =
        parseInt(getOptionalInput("timeout") || "900", 10) * 1000;
      const pollIntervalMs =
        parseInt(getOptionalInput("poll_interval") || "15", 10) * 1000;
      const e2eRunId = getOptionalInput("e2e_run_id");

      const fixture: TestFixture = fixtureJson
        ? JSON.parse(fixtureJson)
        : { name: "wait-phase", description: "Wait for phase" };

      // Get phase-specific expectations if available
      const phaseExpectation = fixture.expected?.phases?.[phaseNumber - 1];

      // Build e2e config from fixture if e2e_run_id is provided
      const e2eConfig = e2eRunId
        ? {
            runId: e2eRunId,
            outcomes: fixture.e2e_outcomes || {
              ci: ["success"],
              release: ["success"],
              review: ["approved"],
            },
          }
        : undefined;

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: wait-phase`);
      core.info(`Issue: #${issueNumber}`);
      core.info(`Phase: ${phaseNumber}`);
      if (e2eConfig) {
        core.info(`E2E Run ID: ${e2eConfig.runId}`);
      }

      const result = await waitForPhase({
        octokit,
        owner,
        repo,
        issueNumber,
        phaseNumber,
        projectNumber,
        timeoutMs,
        pollIntervalMs,
        expectations: phaseExpectation,
        e2eConfig,
      });

      setOutputs({
        success: String(result.success),
        branch_name: result.branch_name || "",
        pr_number: result.pr_number ? String(result.pr_number) : "",
        pr_state: result.pr_state || "",
        ci_status: result.ci_status || "",
        review_status: result.review_status || "",
        issue_state: result.issue_state,
        issue_status: result.issue_status || "",
        errors: result.errors.join("; "),
        total_duration_ms: String(result.duration_ms),
      });

      if (!result.success) {
        if (cleanupOnFailure) {
          await triggerCleanup(octokit, owner, repo, issueNumber);
        }
        core.setFailed(
          `Phase ${phaseNumber} verification failed: ${result.errors.join("; ")}`,
        );
      } else {
        core.info(`Phase ${phaseNumber} completed and verified successfully`);
      }

      return;
    }

    // Status action - quick status check
    if (action === "status") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: status`);
      core.info(`Issue: #${issueNumber}`);

      const state = await fetchGitHubState(
        octokit,
        owner,
        repo,
        issueNumber,
        projectNumber,
      );

      const workflowRuns = await fetchRecentWorkflowRuns(
        octokit,
        owner,
        repo,
        issueNumber,
      );

      const context = buildContextFromState(state, owner, repo);
      const predicted = predictNextState(context);

      setOutputs({
        status: state.projectStatus || "unknown",
        iteration: String(state.iteration),
        failures: String(state.failures),
        bot_assigned: String(state.botAssigned),
        pr_number: state.prNumber ? String(state.prNumber) : "",
        pr_state: state.prState || "",
        branch_exists: String(state.branchExists),
        unchecked_todos: String(state.uncheckedTodos),
        predicted_state: predicted.expectedState,
        predicted_status: predicted.expectedStatus || "",
        workflow_status:
          workflowRuns.length > 0
            ? workflowRuns[0]?.status || "unknown"
            : "none",
      });

      core.info(`\nCurrent State:`);
      core.info(`  Status: ${state.projectStatus || "unknown"}`);
      core.info(`  Iteration: ${state.iteration}`);
      core.info(`  Failures: ${state.failures}`);
      core.info(`  Bot Assigned: ${state.botAssigned}`);
      core.info(
        `  PR: ${state.prNumber ? `#${state.prNumber} (${state.prState})` : "none"}`,
      );
      core.info(`  Branch: ${state.branch || "none"}`);
      core.info(`  Unchecked Todos: ${state.uncheckedTodos}`);
      core.info(`\nPrediction:`);
      core.info(`  Expected State: ${predicted.expectedState}`);
      core.info(
        `  Expected Status: ${predicted.expectedStatus || "unchanged"}`,
      );
      core.info(`  Description: ${predicted.description}`);

      return;
    }

    // Validate action - validate fixture against schema
    if (action === "validate") {
      const fixtureJson = getRequiredInput("fixture_json");

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: validate`);

      let fixture: unknown;
      try {
        fixture = JSON.parse(fixtureJson);
      } catch (error) {
        core.setFailed(`Invalid JSON: ${error}`);
        setOutputs({
          valid: "false",
          errors: `Invalid JSON: ${error}`,
          warnings: "",
        });
        return;
      }

      const result = validateFixture(fixture);
      const formatted = formatValidationResult("fixture", result);

      core.info(`\n${formatted}`);

      setOutputs({
        valid: String(result.valid),
        errors: result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
        warnings: result.warnings.join("; "),
      });

      if (!result.valid) {
        core.setFailed(`Fixture validation failed`);
      }

      return;
    }

    // Run-configurable action - state-based fixture testing
    if (action === "run-configurable") {
      const scenarioName = getRequiredInput("scenario_name");
      const continueRun = getOptionalInput("continue") !== "false";
      const mockClaude = getOptionalInput("mock_claude") !== "false";
      const mockCI = getOptionalInput("mock_ci") !== "false";
      const startStep = getOptionalInput("start_step");
      const multiIssue = getOptionalInput("multi_issue") !== "false";

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: run-configurable`);
      core.info(`Scenario: ${scenarioName}`);
      core.info(`Continue: ${continueRun}`);
      core.info(`Mock Claude: ${mockClaude}`);
      core.info(`Mock CI: ${mockCI}`);
      core.info(`Multi Issue: ${multiIssue}`);
      if (startStep) {
        core.info(`Start Step: ${startStep}`);
      }

      // Load scenario
      const scenario = await loadScenario(scenarioName);

      // Build test runner inputs
      const inputs: TestRunnerInputs = {
        continue: continueRun,
        startStep: startStep || undefined,
        mockClaude,
        mockCI,
        multiIssue,
      };

      // Run the configurable test
      const result = await runConfigurableTest(scenario, inputs, {
        octokit,
        owner,
        repo,
        projectNumber,
      });

      // Set outputs
      setOutputs({
        status: result.status,
        issue_number: String(result.issueNumber),
        transitions: JSON.stringify(result.transitions),
        total_duration_ms: String(result.totalDurationMs),
        current_state: result.currentState || "",
        next_state: result.nextState || "",
        error: result.error || "",
      });

      if (result.status === "failed" || result.status === "error") {
        core.setFailed(`Test ${result.status}: ${result.error}`);
      } else if (result.status === "completed") {
        core.info(
          `Test completed successfully with ${result.transitions.length} transitions`,
        );
      } else if (result.status === "paused") {
        core.info(
          `Test paused at ${result.currentState} -> ${result.nextState}`,
        );
      }

      return;
    }

    // Run-discussion action - discussion state-based fixture testing
    if (action === "run-discussion") {
      const scenarioName = getRequiredInput("scenario_name");
      const mockClaude = getOptionalInput("mock_claude") !== "false";

      core.info(`=== Claude Test Runner ===`);
      core.info(`Action: run-discussion`);
      core.info(`Scenario: ${scenarioName}`);
      core.info(`Mock Claude: ${mockClaude}`);

      // Load discussion scenario
      const scenario = await loadDiscussionScenario(scenarioName);

      // Build test runner inputs
      const inputs: DiscussionTestRunnerInputs = {
        mockClaude,
      };

      // Run the discussion test
      const result = await runDiscussionConfigurableTest(scenario, inputs, {
        octokit,
        owner,
        repo,
        projectNumber,
      });

      // Set outputs
      setOutputs({
        status: result.status,
        discussion_number: String(result.discussionNumber),
        final_state: result.finalState,
        actions_executed: String(result.actionsExecuted),
        total_duration_ms: String(result.totalDurationMs),
        verification_errors: result.verificationErrors?.join("; ") || "",
        error: result.error || "",
      });

      if (result.status === "failed" || result.status === "error") {
        core.setFailed(
          `Discussion test ${result.status}: ${result.error || result.verificationErrors?.join("; ")}`,
        );
      } else if (result.status === "completed") {
        core.info(
          `Discussion test completed successfully. Final state: ${result.finalState}, Actions: ${result.actionsExecuted}`,
        );
      }

      return;
    }

    core.setFailed(`Unknown action: ${action}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
