/**
 * BaseVerifier — abstract base class for machine verification.
 *
 * Provides union-aware outcome verification and retrigger checking.
 * Subclasses implement domain-specific tree extraction, comparison, and retrigger logic.
 */

import type { FieldDiff, VerifyResult, VerificationResult } from "./types.js";

export abstract class BaseVerifier<TTree, TContext> {
  /** Extract a verifiable state snapshot from execution context. */
  abstract extractTree(context: TContext): TTree;

  /** Compare a single expected tree against actual. Return field diffs. */
  abstract compareTree(expected: TTree, actual: TTree): FieldDiff[];

  /** Predict whether the workflow should retrigger after this state. */
  abstract predictRetrigger(finalState: string): boolean;

  /**
   * Union-aware verification: passes if ANY expected outcome matches.
   * Returns best match for diagnostics.
   */
  verifyOutcomes(expected: TTree[], actual: TTree): VerifyResult {
    if (expected.length === 0) {
      return {
        pass: true,
        matchedOutcomeIndex: null,
        bestMatch: { outcomeIndex: -1, diffs: [] },
      };
    }

    let bestIndex = 0;
    let bestDiffs: FieldDiff[] = [];
    let foundMatch = false;

    for (let i = 0; i < expected.length; i++) {
      const outcome = expected[i];
      if (!outcome) continue;
      const diffs = this.compareTree(outcome, actual);

      if (diffs.length === 0) {
        return {
          pass: true,
          matchedOutcomeIndex: i,
          bestMatch: { outcomeIndex: i, diffs: [] },
        };
      }

      if (!foundMatch || diffs.length < bestDiffs.length) {
        bestIndex = i;
        bestDiffs = diffs;
        foundMatch = true;
      }
    }

    return {
      pass: false,
      matchedOutcomeIndex: null,
      bestMatch: { outcomeIndex: bestIndex, diffs: bestDiffs },
    };
  }

  /**
   * Full verification including retrigger check.
   */
  verify(
    expected: TTree[],
    actual: TTree,
    opts: { expectedRetrigger: boolean; actualRetrigger?: boolean },
  ): VerificationResult {
    const result = this.verifyOutcomes(expected, actual);
    const retriggerPass =
      opts.actualRetrigger === undefined ||
      opts.expectedRetrigger === opts.actualRetrigger;
    return {
      pass: result.pass && retriggerPass,
      result,
      retriggerPass,
    };
  }
}
