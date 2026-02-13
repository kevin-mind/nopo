/**
 * Shared helpers for state mutators.
 */

import type {
  PredictableStateTree,
  PredictableIssueState,
  PredictableSubIssueState,
} from "../predictable-state.js";
import type { HistoryEntry } from "@more/issue-state";
import type { MachineContext } from "../../schemas/state.js";
import { getTransitionName } from "../../runner/derive.js";

/**
 * Deep-clone a PredictableStateTree for mutation.
 *
 * History entries are cleared so that only entries added by the mutator
 * (i.e. predictions for *this* run) end up in the expected tree.  The
 * verify comparison checks that each expected entry exists somewhere in
 * the actual (full) history — pre-existing entries are not re-verified.
 */
export function cloneTree(tree: PredictableStateTree): PredictableStateTree {
  const clone = structuredClone(tree);
  clone.issue.body.historyEntries = [];
  for (const sub of clone.subIssues) {
    sub.body.historyEntries = [];
  }
  return clone;
}

/**
 * Find the sub-issue matching the current phase in the tree.
 *
 * When processing a sub-issue directly (e.g., CI completion on the sub-issue),
 * `currentSubIssue` is null because `findCurrentPhase` looks at the issue's
 * own sub-issues (which a sub-issue doesn't have). In this case, the issue
 * itself IS the sub-issue, so we look it up by `context.issue.number`.
 */
export function findCurrentSubIssue(
  tree: PredictableStateTree,
  context: MachineContext,
): PredictableSubIssueState | undefined {
  const subNumber = context.currentSubIssue?.number;
  if (subNumber) {
    return tree.subIssues.find((s) => s.number === subNumber);
  }
  // Processing a sub-issue directly (not through orchestration)
  if (context.parentIssue) {
    return tree.subIssues.find((s) => s.number === context.issue.number);
  }
  return undefined;
}

/**
 * Add a history entry to the issue's body structure.
 */
export function addHistoryEntry(
  issue: PredictableIssueState,
  entry: Pick<HistoryEntry, "iteration" | "phase" | "action">,
): void {
  issue.body.historyEntries.push({
    iteration: entry.iteration,
    phase: entry.phase,
    action: entry.action,
    timestamp: null,
    sha: null,
    runLink: null,
  });
}

/**
 * Generate the success history entry for a given state name.
 * Matches the `✅ {transitionName}` format that logRunEnd writes on success.
 */
export function successEntry(stateName: string): string {
  return `✅ ${getTransitionName(stateName)}`;
}

// ============================================================================
// Iteration History Constants
// ============================================================================

/** Predict opened-PR outcome */
export const ITER_OPENED_PR = "✅ Opened PR";
/** Predict updated-PR outcome */
export const ITER_UPDATED_PR = "✅ Updated PR";
/** Predict fixed-CI outcome */
export const ITER_FIXED_CI = "🔧 Fixed CI";
/** Predict rebase outcome */
export const ITER_REBASED = "🔄 Rebased";
