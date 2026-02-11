/**
 * Review state mutators.
 *
 * Handle reviewing, transitioningToReview, awaitingMerge states.
 */

import type { StateMutator } from "./types.js";
import { HISTORY_MESSAGES } from "../../constants.js";
import { cloneTree, addHistoryEntry, findCurrentSubIssue } from "./helpers.js";

/**
 * reviewing: PR is under review.
 * Status set to In review.
 */
export const reviewingMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const sub = findCurrentSubIssue(tree, context);
  if (sub) {
    sub.projectStatus = "In review";
  }
  return [tree];
};

/**
 * transitioningToReview: Transition from iteration to review.
 *
 * Effects:
 * - Clear failures
 * - PR marked ready (not draft)
 * - Status → In review
 * - Review requested
 * - History: CI Passed → Review requested
 */
export const transitioningToReviewMutator: StateMutator = (
  current,
  context,
) => {
  const tree = cloneTree(current);
  const sub = findCurrentSubIssue(tree, context);

  if (sub) {
    sub.projectStatus = "In review";
    if (sub.pr) {
      sub.pr.isDraft = false;
    }
  }

  tree.issue.failures = 0;

  // History updates
  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration,
    phase,
    action: HISTORY_MESSAGES.REVIEW_REQUESTED,
  });

  return [tree];
};

/**
 * awaitingMerge: PR approved, waiting for merge.
 * Status → In review (stays).
 */
export const awaitingMergeMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const sub = findCurrentSubIssue(tree, context);
  if (sub) {
    sub.projectStatus = "In review";
  }
  return [tree];
};
