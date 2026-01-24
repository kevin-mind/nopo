/**
 * Diagnostics engine for test failures
 *
 * Analyzes why a test failed and provides actionable suggestions
 */

import type {
  Diagnosis,
  GitHubState,
  GuardResult,
  PredictedState,
  WorkflowRun,
} from "./types.js";

/**
 * Guard fix suggestions keyed by guard name
 */
const GUARD_FIXES: Record<
  string,
  (state: GitHubState) => { reason: string; fix: string }
> = {
  todosDone: (state) => ({
    reason: `${state.uncheckedTodos} unchecked todos remain`,
    fix: `Complete ${state.uncheckedTodos} remaining todos in the issue body`,
  }),
  ciPassed: () => ({
    reason: "CI has not passed",
    fix: "Wait for CI to complete successfully, or fix failing tests",
  }),
  ciFailed: () => ({
    reason: "CI has not failed",
    fix: "CI is still running or passed - wait for completion",
  }),
  maxFailuresReached: (state) => ({
    reason: `Failure count (${state.failures}) has reached maximum`,
    fix: "Reset the Failures field to 0 or fix the underlying CI issues",
  }),
  reviewApproved: () => ({
    reason: "PR has not been approved",
    fix: "Request review and get approval from nopo-reviewer",
  }),
  botIsAssigned: (_state) => ({
    reason: `nopo-bot is not assigned (assignees: none visible)`,
    fix: "Assign nopo-bot to the issue to trigger automation",
  }),
  hasPR: (state) => ({
    reason: state.prNumber ? "PR exists" : "No PR exists for this issue",
    fix: state.prNumber
      ? "PR already exists"
      : "Create a PR for the issue branch",
  }),
  hasBranch: (state) => ({
    reason: state.branchExists ? "Branch exists" : "Branch does not exist",
    fix: state.branchExists
      ? "Branch already exists"
      : "Branch will be created on first iteration",
  }),
  isInReview: (state) => ({
    reason:
      state.projectStatus === "In review"
        ? "Issue is in review"
        : "Issue is not in review",
    fix:
      state.projectStatus === "In review"
        ? "Wait for review completion"
        : "Complete todos and pass CI to transition to review",
  }),
  needsTriage: (state) => ({
    reason: state.labels.includes("triaged")
      ? "Issue has 'triaged' label"
      : "Issue missing 'triaged' label",
    fix: state.labels.includes("triaged")
      ? "Issue is already triaged"
      : "Run triage workflow or add 'triaged' label",
  }),
};

/**
 * Evaluate guards to diagnose what's blocking progress
 */
function evaluateGuards(
  state: GitHubState,
  expected: PredictedState,
): GuardResult[] {
  const results: GuardResult[] = [];

  // Common guards to check
  const guardsToCheck = [
    "todosDone",
    "ciPassed",
    "maxFailuresReached",
    "reviewApproved",
    "botIsAssigned",
    "hasPR",
    "hasBranch",
    "isInReview",
    "needsTriage",
  ];

  for (const guardName of guardsToCheck) {
    const guardFn = GUARD_FIXES[guardName];
    if (!guardFn) continue;

    const { reason, fix } = guardFn(state);

    // Determine if guard passed and if it was expected
    let passed = false;
    let expectation = false;

    switch (guardName) {
      case "todosDone":
        passed = state.uncheckedTodos === 0;
        expectation = expected.expectedState === "reviewing"; // Need todos done for review
        break;
      case "ciPassed":
        // Can't determine from state alone - would need workflow info
        passed = false;
        expectation = expected.triggersNeeded.includes("CI_SUCCESS");
        break;
      case "maxFailuresReached":
        passed = state.failures >= 5; // Assuming max is 5
        expectation = expected.expectedState === "blocked";
        break;
      case "reviewApproved":
        passed = state.prState === "MERGED";
        expectation = expected.triggersNeeded.includes("REVIEW_APPROVED");
        break;
      case "botIsAssigned":
        passed = state.botAssigned;
        expectation = true; // Always expect bot to be assigned for automation
        break;
      case "hasPR":
        passed = state.prNumber !== null;
        expectation =
          expected.expectedState === "reviewing" ||
          expected.expectedState === "prReviewing";
        break;
      case "hasBranch":
        passed = state.branchExists;
        expectation = expected.expectedState !== "detecting";
        break;
      case "isInReview":
        passed = state.projectStatus === "In review";
        expectation = expected.expectedState === "reviewing";
        break;
      case "needsTriage":
        passed = !state.labels.includes("triaged");
        expectation = expected.expectedState === "triaging";
        break;
    }

    results.push({
      name: guardName,
      passed,
      expected: expectation,
      reason,
      fix: !passed && expectation ? fix : null,
    });
  }

  return results;
}

/**
 * Determine workflow status from recent runs
 */
function getWorkflowStatus(
  runs: WorkflowRun[],
): "running" | "waiting" | "failed" | "not_triggered" {
  if (runs.length === 0) {
    return "not_triggered";
  }

  const latestRun = runs[0];
  if (!latestRun) {
    return "not_triggered";
  }

  if (latestRun.status === "in_progress" || latestRun.status === "queued") {
    return "running";
  }

  if (latestRun.conclusion === "failure") {
    return "failed";
  }

  return "waiting";
}

/**
 * Diagnose why a test failed
 *
 * Analyzes the expected vs actual state and provides actionable fixes
 */
export function diagnoseFailure(
  expected: PredictedState,
  actual: GitHubState,
  workflowRuns: WorkflowRun[],
): Diagnosis {
  const workflowStatus = getWorkflowStatus(workflowRuns);
  const guardResults = evaluateGuards(actual, expected);

  // Check for terminal states first
  if (actual.projectStatus === "Done") {
    return {
      status: "done",
      suggestedFix: "Issue is complete - no action needed",
      diagnosis: "Issue has reached Done status",
      details: {
        expectedState: expected.expectedState,
        actualState: actual.projectStatus || "unknown",
        expectedStatus: expected.expectedStatus,
        actualStatus: actual.projectStatus,
        guardsEvaluated: guardResults,
        workflowStatus,
        workflowRuns,
      },
    };
  }

  if (actual.projectStatus === "Blocked") {
    return {
      status: "error",
      suggestedFix:
        "Issue is blocked - reset Failures field or fix underlying issues",
      diagnosis: `Circuit breaker triggered after ${actual.failures} failures`,
      details: {
        expectedState: expected.expectedState,
        actualState: "blocked",
        expectedStatus: expected.expectedStatus,
        actualStatus: actual.projectStatus,
        guardsEvaluated: guardResults,
        workflowStatus,
        workflowRuns,
      },
    };
  }

  // Check if workflow is still running
  if (workflowStatus === "running") {
    const runningRun = workflowRuns.find(
      (r) => r.status === "in_progress" || r.status === "queued",
    );
    return {
      status: "timeout",
      suggestedFix: `Wait longer - workflow "${runningRun?.name || "unknown"}" is still running`,
      diagnosis: `Workflow ${runningRun?.id || "unknown"} is in progress`,
      details: {
        expectedState: expected.expectedState,
        actualState: actual.projectStatus || "unknown",
        expectedStatus: expected.expectedStatus,
        actualStatus: actual.projectStatus,
        guardsEvaluated: guardResults,
        workflowStatus: "running",
        workflowRuns,
      },
    };
  }

  // Check for failed workflows
  if (workflowStatus === "failed") {
    const failedRun = workflowRuns.find((r) => r.conclusion === "failure");
    return {
      status: "error",
      suggestedFix: `Check workflow logs: ${failedRun?.url || "unknown"}`,
      diagnosis: `Workflow failed: ${failedRun?.displayTitle || "unknown"}`,
      details: {
        expectedState: expected.expectedState,
        actualState: actual.projectStatus || "unknown",
        expectedStatus: expected.expectedStatus,
        actualStatus: actual.projectStatus,
        guardsEvaluated: guardResults,
        workflowStatus: "failed",
        workflowRuns,
      },
    };
  }

  // Check for no workflow triggered
  if (workflowStatus === "not_triggered" && !actual.botAssigned) {
    return {
      status: "error",
      suggestedFix: "Assign nopo-bot to the issue to trigger automation",
      diagnosis: "No workflow triggered - nopo-bot is not assigned",
      details: {
        expectedState: expected.expectedState,
        actualState: actual.projectStatus || "unknown",
        expectedStatus: expected.expectedStatus,
        actualStatus: actual.projectStatus,
        guardsEvaluated: guardResults,
        workflowStatus: "not_triggered",
        workflowRuns,
      },
    };
  }

  // Find the first blocking guard
  const blockingGuard = guardResults.find((g) => g.expected && !g.passed);
  if (blockingGuard && blockingGuard.fix) {
    return {
      status: "timeout",
      suggestedFix: blockingGuard.fix,
      diagnosis: `Guard '${blockingGuard.name}' failed: ${blockingGuard.reason}`,
      details: {
        expectedState: expected.expectedState,
        actualState: actual.projectStatus || "unknown",
        expectedStatus: expected.expectedStatus,
        actualStatus: actual.projectStatus,
        guardsEvaluated: guardResults,
        workflowStatus,
        workflowRuns,
      },
    };
  }

  // Generic timeout
  return {
    status: "timeout",
    suggestedFix:
      "Unknown failure - check issue history and workflow logs manually",
    diagnosis: `Expected state '${expected.expectedState}' not reached, actual status: ${actual.projectStatus || "unknown"}`,
    details: {
      expectedState: expected.expectedState,
      actualState: actual.projectStatus || "unknown",
      expectedStatus: expected.expectedStatus,
      actualStatus: actual.projectStatus,
      guardsEvaluated: guardResults,
      workflowStatus,
      workflowRuns,
    },
  };
}

/**
 * Format a diagnosis for logging
 */
export function formatDiagnosis(diagnosis: Diagnosis): string {
  const lines: string[] = [
    `Status: ${diagnosis.status}`,
    `Suggested Fix: ${diagnosis.suggestedFix}`,
    `Diagnosis: ${diagnosis.diagnosis}`,
    "",
    "Details:",
    `  Expected State: ${diagnosis.details.expectedState}`,
    `  Actual State: ${diagnosis.details.actualState}`,
    `  Expected Status: ${diagnosis.details.expectedStatus || "N/A"}`,
    `  Actual Status: ${diagnosis.details.actualStatus || "N/A"}`,
    `  Workflow Status: ${diagnosis.details.workflowStatus}`,
  ];

  if (diagnosis.details.workflowRuns.length > 0) {
    lines.push("");
    lines.push("Recent Workflow Runs:");
    for (const run of diagnosis.details.workflowRuns.slice(0, 3)) {
      lines.push(
        `  - ${run.name}: ${run.status} (${run.conclusion || "pending"}) - ${run.url}`,
      );
    }
  }

  const blockingGuards = diagnosis.details.guardsEvaluated.filter(
    (g) => g.expected && !g.passed,
  );
  if (blockingGuards.length > 0) {
    lines.push("");
    lines.push("Blocking Guards:");
    for (const guard of blockingGuards) {
      lines.push(`  - ${guard.name}: ${guard.reason}`);
      if (guard.fix) {
        lines.push(`    Fix: ${guard.fix}`);
      }
    }
  }

  return lines.join("\n");
}
