/**
 * Control flow state mutators.
 *
 * Handle processingCI, processingReview, processingMerge, prPush, resetting,
 * and other transitional states.
 */

import type { StateMutator } from "./types.js";
import { HISTORY_MESSAGES } from "../../constants.js";
import {
  cloneTree,
  addHistoryEntry,
  findCurrentSubIssue,
  successEntry,
} from "./helpers.js";
import { getTransitionName } from "../../runner/derive.js";

/**
 * processingCI: Determine outcome based on CI result and todos.
 *
 * Guard paths (deterministic given ciResult + todosDone):
 * - readyForReview: CI passed + todos done → In review
 * - ciPassed: CI passed + todos remain → continue iterating
 * - shouldBlock: CI failed + max failures → blocked
 * - ciFailed: CI failed → fix CI iteration
 */
export const processingCIMutator: StateMutator = (current, context) => {
  const ciPassed = context.ciResult === "success";
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration;

  if (ciPassed) {
    const tree = cloneTree(current);
    addHistoryEntry(tree.issue, {
      iteration,
      phase,
      action: successEntry("processingCI"),
    });
    return [tree];
  }

  // CI failed
  const tree = cloneTree(current);
  addHistoryEntry(tree.issue, {
    iteration,
    phase,
    action: `❌ ${getTransitionName("processingCI")}`,
  });
  return [tree];
};

/**
 * prPush: Push to draft flow.
 * PR → draft, status → In progress, history: code pushed.
 */
export const prPushMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const sub = findCurrentSubIssue(tree, context);

  if (sub?.pr) {
    sub.pr.isDraft = true;
  }
  if (sub) {
    sub.projectStatus = "In progress";
  }

  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: 0,
    phase,
    action: HISTORY_MESSAGES.CODE_PUSHED,
  });

  return [tree];
};

/**
 * resetting: Reset to initial state.
 * Parent → Backlog, failures cleared, sub-issues removed from project.
 */
export const resettingMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  tree.issue.projectStatus = "Backlog";
  tree.issue.failures = 0;
  tree.issue.assignees = tree.issue.assignees.filter(
    (a) => a !== context.botUsername,
  );

  for (const sub of tree.subIssues) {
    sub.projectStatus = null;
  }

  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration,
    phase,
    action: successEntry("resetting"),
  });

  return [tree];
};

/**
 * processingMerge: PR merged → close sub-issue → orchestrate.
 * Sub-issue → Done + CLOSED, history: merged.
 */
export const processingMergeMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  tree.issue.projectStatus = "Done";
  tree.issue.state = "CLOSED";

  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration ?? 0,
    phase,
    action: HISTORY_MESSAGES.MERGED,
  });

  return [tree];
};

/**
 * invalidIteration: Fatal error, issue set to Error.
 */
export const invalidIterationMutator: StateMutator = (current) => {
  const tree = cloneTree(current);
  tree.issue.projectStatus = "Error";
  return [tree];
};

/**
 * subIssueIdle: No-op, sub-issue edited but not assigned.
 */
export const subIssueIdleMutator: StateMutator = (current) => {
  return [cloneTree(current)];
};
