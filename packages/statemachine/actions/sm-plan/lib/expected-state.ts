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

    // Build the expected state envelope
    const expected = Verify.buildExpectedState({
      finalState,
      outcomes,
      trigger: machineContext.trigger,
      issueNumber,
      parentIssueNumber,
    });

    core.info(
      `Expected state built: finalState=${finalState}, outcomes=${outcomes.length}`,
    );

    return JSON.stringify(expected);
  } catch (error) {
    core.warning(`Failed to build expected state: ${error}`);
    return null;
  }
}
