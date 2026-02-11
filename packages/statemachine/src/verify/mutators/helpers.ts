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

/**
 * Deep-clone a PredictableStateTree for mutation.
 */
export function cloneTree(tree: PredictableStateTree): PredictableStateTree {
  return structuredClone(tree);
}

/**
 * Find the sub-issue matching the current phase in the tree.
 */
export function findCurrentSubIssue(
  tree: PredictableStateTree,
  context: MachineContext,
): PredictableSubIssueState | undefined {
  const subNumber = context.currentSubIssue?.number;
  if (!subNumber) return undefined;
  return tree.subIssues.find((s) => s.number === subNumber);
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
 * Update the most recent history entry matching a pattern.
 */
export function updateHistoryEntry(
  issue: PredictableIssueState,
  matchPattern: string,
  newAction: string,
  iteration: number,
  phase: string,
): void {
  // Search from end for most recent match
  for (let i = issue.body.historyEntries.length - 1; i >= 0; i--) {
    const entry = issue.body.historyEntries[i];
    if (
      entry &&
      entry.iteration === iteration &&
      entry.phase === phase &&
      entry.action.includes(matchPattern)
    ) {
      entry.action = newAction;
      return;
    }
  }
}
