/**
 * MachineVerifier — prediction + comparison for the invoke machine.
 *
 * Extends BaseVerifier with issue-specific tree extraction, comparison,
 * and retrigger logic.
 */

import type { MachineContext } from "../../core/schemas.js";
import {
  BaseVerifier,
  type FieldDiff,
  type VerificationResult,
} from "../../core/verifier/index.js";

import {
  extractPredictableTree,
  buildExpectedState,
  type PredictableStateTree,
  type ExpectedState,
} from "./verify/predictable-state.js";
import { predictFromActions } from "./verify/predict.js";
import { compareTreeFields } from "./verify/compare.js";
import type { MachineResult } from "./machine.js";

export type { VerificationResult };

/**
 * MachineVerifier handles prediction and verification of machine execution.
 */
export class MachineVerifier extends BaseVerifier<
  PredictableStateTree,
  MachineContext
> {
  /**
   * Extract a predictable state tree from a machine context.
   */
  extractTree(context: MachineContext): PredictableStateTree {
    return extractPredictableTree(context);
  }

  /**
   * Compare a single expected tree against actual. Returns field diffs.
   */
  compareTree(
    expected: PredictableStateTree,
    actual: PredictableStateTree,
  ): FieldDiff[] {
    return compareTreeFields(expected, actual);
  }

  /**
   * Predict whether the workflow should retrigger after execution.
   * Uses an allowlist of states that need retrigger.
   */
  predictRetrigger(finalState: string): boolean {
    const retriggerStates = new Set([
      "orchestrationRunning",
      "triaging",
      "resetting",
      "prReviewAssigned",
    ]);
    return retriggerStates.has(finalState);
  }

  /**
   * Predict expected post-execution state from machine results.
   * Issue-specific — not part of BaseVerifier.
   */
  predictExpectedState(
    machineResult: MachineResult,
    machineContext: MachineContext,
  ): ExpectedState {
    const currentTree = extractPredictableTree(machineContext);

    const outcomes = predictFromActions(
      machineResult.actions,
      currentTree,
      machineContext,
      { finalState: machineResult.state },
    );

    const issueNumber =
      machineContext.parentIssue?.number ?? machineContext.issue.number;
    const parentIssueNumber = machineContext.parentIssue?.number ?? null;
    const expectedRetrigger = this.predictRetrigger(machineResult.state);

    return buildExpectedState({
      finalState: machineResult.state,
      outcomes,
      expectedRetrigger,
      trigger: machineContext.trigger,
      issueNumber,
      parentIssueNumber,
    });
  }

  /**
   * Convenience method: verify an ExpectedState against actual state.
   * Wraps the base verify() to match the existing caller interface.
   *
   * @deprecated Prefer using base verify() directly with explicit opts.
   */
  verifyExpected(
    expected: ExpectedState,
    actualTree: PredictableStateTree,
    actualRetrigger?: boolean,
  ): VerificationResult {
    return this.verify(expected.outcomes, actualTree, {
      expectedRetrigger: expected.expectedRetrigger,
      actualRetrigger,
    });
  }

  /**
   * Alias for extractTree — backward compatibility.
   */
  extractStateTree(machineContext: MachineContext): PredictableStateTree {
    return this.extractTree(machineContext);
  }
}
