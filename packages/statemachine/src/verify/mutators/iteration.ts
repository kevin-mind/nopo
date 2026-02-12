/**
 * Iteration state mutators.
 *
 * Handle iterating and iteratingFix states.
 */

import type { StateMutator } from "./types.js";
import {
  cloneTree,
  addHistoryEntry,
  findCurrentSubIssue,
  successEntry,
} from "./helpers.js";

/**
 * iterating: Claude implements the issue.
 *
 * Expected effects:
 * - Status set to In progress (working)
 * - Iteration incremented
 * - History: ⏳ Iterating...
 * - Branch created if needed
 * - PR created if needed (draft)
 *
 * AI-dependent: could produce working state (still has todos) or all_done
 * (todos complete → review). For simplicity, we predict the working state.
 */
export const iteratingMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const sub = findCurrentSubIssue(tree, context);

  // Sub-issue status → In progress
  if (sub) {
    sub.projectStatus = "In progress";
    sub.hasBranch = true;
    sub.hasPR = true;
    if (sub.pr) {
      sub.pr.isDraft = true;
    }
  }

  // History: predict the final success entry that logRunEnd writes
  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration + 1,
    phase,
    action: successEntry("iterating"),
  });

  return [tree];
};

/**
 * iteratingFix: Claude fixes CI failures.
 *
 * Same structural effects as iterating but with a different history entry.
 */
export const iteratingFixMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const sub = findCurrentSubIssue(tree, context);

  if (sub) {
    sub.projectStatus = "In progress";
    sub.hasBranch = true;
    sub.hasPR = true;
    if (sub.pr) {
      sub.pr.isDraft = true;
    }
  }

  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration + 1,
    phase,
    action: successEntry("iteratingFix"),
  });

  return [tree];
};
