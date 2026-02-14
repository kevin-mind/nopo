/**
 * MachineVerifier — prediction + comparison for the invoke machine.
 *
 * Consolidates the prediction and verification logic currently scattered
 * across verify/predict.ts, verify/predictable-state.ts, verify/compare.ts,
 * and sm-plan/lib/expected-state.ts.
 */

import type { MachineContext } from "../../core/schemas.js";

import {
  extractPredictableTree,
  buildExpectedState,
  type PredictableStateTree,
  type ExpectedState,
} from "../../verify/predictable-state.js";
import { predictFromActions } from "../../verify/predict.js";
import { compareStateTree, type VerifyResult } from "../../verify/compare.js";
import type { MachineResult } from "./issue-machine.js";

/**
 * Full verification result including retrigger check.
 */
export interface VerificationResult {
  pass: boolean;
  result: VerifyResult;
  retriggerPass: boolean;
}

/**
 * MachineVerifier handles prediction and verification of machine execution.
 */
export class MachineVerifier {
  /**
   * Predict expected post-execution state from machine results.
   * Replaces predictExpectedState() in sm-plan/lib/expected-state.ts.
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
   * Extract a predictable state tree from a machine context.
   * Useful for building the "actual" state to compare against.
   */
  extractStateTree(machineContext: MachineContext): PredictableStateTree {
    return extractPredictableTree(machineContext);
  }

  /**
   * Compare expected outcomes against actual state.
   */
  verify(
    expected: ExpectedState,
    actualTree: PredictableStateTree,
    actualRetrigger?: boolean,
  ): VerificationResult {
    const result = compareStateTree(expected.outcomes, actualTree);
    const retriggerPass =
      actualRetrigger === undefined ||
      expected.expectedRetrigger === actualRetrigger;
    return {
      pass: result.pass && retriggerPass,
      result,
      retriggerPass,
    };
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
}
