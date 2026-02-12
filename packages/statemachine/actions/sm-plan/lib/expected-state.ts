/**
 * Expected State Builder
 *
 * Builds the predicted post-run state from a derive result.
 * Uses the verification module's predictable tree extraction and state mutators.
 */

import * as core from "@actions/core";
import {
  Verify,
  type DeriveResult,
  type Action,
  isDiscussionTrigger,
} from "@more/statemachine";

/**
 * Predict whether the workflow should retrigger after execution.
 * Mirrors the shouldRetrigger logic in sm-run, assuming continue=true.
 *
 * @param issueNumber - The main/triggering issue number, used to distinguish
 *   sub-issue assignUser actions from parent assignUser actions.
 */
function predictRetrigger(
  finalState: string,
  actions: Action[],
  issueNumber?: number,
): boolean {
  // Don't retrigger for iteration Claude runs — Claude pushes code,
  // which triggers CI, which triggers the next workflow event.
  const iterationStates = new Set(["iterating", "iteratingFix"]);
  const hasClaudeRun = actions.some((a) => a.type === "runClaude");
  if (hasClaudeRun && iterationStates.has(finalState)) {
    return false;
  }

  // orchestrationRunning: retrigger only when no assignUser was emitted for
  // a sub-issue. When bot is already assigned, GitHub won't fire an
  // issues:assigned webhook, so retrigger must restart iteration on the sub-issue.
  if (finalState === "orchestrationRunning") {
    const hasSubIssueAssign = actions.some(
      (a) =>
        a.type === "assignUser" &&
        "issueNumber" in a &&
        a.issueNumber !== issueNumber,
    );
    return !hasSubIssueAssign;
  }

  // Terminal/waiting states that should not retrigger
  const noRetriggerStates = new Set([
    "done",
    "blocked",
    "error",
    "alreadyDone",
    "alreadyBlocked",
    "terminal",
    "reviewing",
    "grooming",
    "commenting",
    "orchestrationWaiting",
    "orchestrationComplete",
    "subIssueIdle",
  ]);

  return !noRetriggerStates.has(finalState);
}

/**
 * Build expected state JSON from a derive result.
 *
 * Returns null if:
 * - The derive result has no machine context (discussion triggers)
 * - No mutator is registered for the final state
 * - An error occurs during prediction
 */
export function predictExpectedState(
  deriveResult: DeriveResult,
): string | null {
  const { finalState, machineContext } = deriveResult;

  if (!machineContext) {
    core.info("No machine context available — skipping expected state");
    return null;
  }

  if (isDiscussionTrigger(machineContext.trigger)) {
    core.info("Discussion trigger — skipping expected state");
    return null;
  }

  try {
    // Extract current state tree from the machine context
    const currentTree = Verify.extractPredictableTree(machineContext);

    // Apply the mutator for the final state to get expected outcomes
    const mutator = Verify.getMutator(finalState);
    const outcomes = mutator
      ? mutator(currentTree, machineContext)
      : [currentTree];

    const issueNumber =
      machineContext.parentIssue?.number ?? machineContext.issue.number;
    const parentIssueNumber = machineContext.parentIssue?.number ?? null;

    // Predict whether retrigger should occur (assumes continue=true)
    const expectedRetrigger = predictRetrigger(
      finalState,
      deriveResult.pendingActions,
      machineContext.issue.number,
    );

    // Build the expected state envelope
    const expected = Verify.buildExpectedState({
      finalState,
      outcomes,
      expectedRetrigger,
      trigger: machineContext.trigger,
      issueNumber,
      parentIssueNumber,
    });

    core.info(
      `Expected state built: finalState=${finalState}, outcomes=${outcomes.length}, expectedRetrigger=${expectedRetrigger}`,
    );

    return JSON.stringify(expected);
  } catch (error) {
    core.warning(`Failed to build expected state: ${error}`);
    return null;
  }
}
