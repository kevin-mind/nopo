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
  ITER_OPENED_PR,
  ITER_UPDATED_PR,
  ITER_FIXED_CI,
  ITER_REBASED,
} from "./helpers.js";

/**
 * iterating: Claude implements the issue.
 *
 * Three possible outcomes:
 * 1. Opened PR — first iteration, no PR yet
 * 2. Updated PR — subsequent iteration, PR exists
 * 3. Rebased — branch was stale, only rebase happened (no structural changes)
 */
export const iteratingMutator: StateMutator = (current, context) => {
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration;

  // Outcome 1: Opened PR (no existing PR)
  const openedTree = cloneTree(current);
  const openedSub = findCurrentSubIssue(openedTree, context);
  if (openedSub) {
    openedSub.projectStatus = "In progress";
    openedSub.hasBranch = true;
    openedSub.hasPR = true;
    if (openedSub.pr) {
      openedSub.pr.isDraft = true;
    }
  }
  addHistoryEntry(openedTree.issue, {
    iteration,
    phase,
    action: ITER_OPENED_PR,
  });

  // Outcome 2: Updated PR (existing PR)
  const updatedTree = cloneTree(current);
  const updatedSub = findCurrentSubIssue(updatedTree, context);
  if (updatedSub) {
    updatedSub.projectStatus = "In progress";
    updatedSub.hasBranch = true;
    updatedSub.hasPR = true;
    if (updatedSub.pr) {
      updatedSub.pr.isDraft = true;
    }
  }
  addHistoryEntry(updatedTree.issue, {
    iteration,
    phase,
    action: ITER_UPDATED_PR,
  });

  // Outcome 3: Rebased (no structural changes, only rebase)
  const rebasedTree = cloneTree(current);
  addHistoryEntry(rebasedTree.issue, {
    iteration,
    phase,
    action: ITER_REBASED,
  });

  return [openedTree, updatedTree, rebasedTree];
};

/**
 * iteratingFix: Claude fixes CI failures.
 *
 * Two possible outcomes (PR always exists for CI fix):
 * 1. Fixed CI — pushed fix commits
 * 2. Rebased — branch was stale, only rebase happened
 */
export const iteratingFixMutator: StateMutator = (current, context) => {
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration;

  // Outcome 1: Fixed CI
  const fixedTree = cloneTree(current);
  const fixedSub = findCurrentSubIssue(fixedTree, context);
  if (fixedSub) {
    fixedSub.projectStatus = "In progress";
    fixedSub.hasBranch = true;
    fixedSub.hasPR = true;
    if (fixedSub.pr) {
      fixedSub.pr.isDraft = true;
    }
  }
  addHistoryEntry(fixedTree.issue, {
    iteration,
    phase,
    action: ITER_FIXED_CI,
  });

  // Outcome 2: Rebased (no structural changes)
  const rebasedTree = cloneTree(current);
  addHistoryEntry(rebasedTree.issue, {
    iteration,
    phase,
    action: ITER_REBASED,
  });

  return [fixedTree, rebasedTree];
};
