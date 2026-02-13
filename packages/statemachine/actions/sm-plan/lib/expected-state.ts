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
  isDiscussionTrigger,
} from "@more/statemachine";

/**
 * Predict whether the workflow should retrigger after execution.
 * Mirrors the shouldRetrigger logic in sm-run, assuming continue=true.
 *
 * Uses an allowlist of states that need retrigger.
 */
function predictRetrigger(finalState: string): boolean {
  const retriggerStates = new Set([
    "orchestrationRunning", // assigned sub-issue, sm-plan routes to iterate
    "triaging", // after triage, grooming should start
    "resetting", // after reset, automation continues
    "prReviewAssigned", // ack review request, retrigger outside PR check context
  ]);

  return retriggerStates.has(finalState);
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
    const expectedRetrigger = predictRetrigger(finalState);

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
