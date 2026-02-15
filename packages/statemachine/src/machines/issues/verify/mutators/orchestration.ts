/**
 * Orchestration state mutators.
 *
 * Handle orchestrationRunning, orchestrationWaiting, orchestrationComplete states.
 */

import type { StateMutator } from "./types.js";
import { HISTORY_MESSAGES } from "../../../../core/constants.js";
import {
  cloneTree,
  addHistoryEntry,
  findCurrentSubIssue,
  successEntry,
} from "./helpers.js";

/**
 * orchestrationRunning: Emit orchestration actions.
 * Orchestration does NOT update project statuses — those happen in iteration.
 * Only structural effects: history entries, assignments.
 *
 * When triggered by /retry, also accounts for retry side-effects:
 * clear failures, clear sub-issue status, set parent to In progress, assign bot.
 */
export const orchestrationRunningMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const isRetry = context.trigger === "issue-retry";

  // Retry: clear failures and sub-issue status, set parent In progress, assign bot
  if (isRetry) {
    tree.issue.failures = 0;
    tree.issue.projectStatus = "In progress";
    if (!tree.issue.assignees.includes(context.botUsername)) {
      tree.issue.assignees.push(context.botUsername);
    }
    const sub = findCurrentSubIssue(tree, context);
    if (sub) {
      sub.projectStatus = null;
    }
    // logRunEnd writes the retry message instead of the generic orchestrate message
    addHistoryEntry(tree.issue, {
      iteration: context.issue.iteration,
      phase: String(context.currentPhase ?? "-"),
      action: HISTORY_MESSAGES.RETRY,
    });
  } else {
    // If needs initialization, add init history
    const needsInit =
      context.issue.projectStatus === null ||
      context.issue.projectStatus === "Backlog";

    if (needsInit) {
      addHistoryEntry(tree.issue, {
        iteration: context.issue.iteration,
        phase: "1",
        action: HISTORY_MESSAGES.initialized(context.issue.subIssues.length),
      });
    }

    // History: predict the final success entry
    const phase = String(context.currentPhase ?? "-");
    addHistoryEntry(tree.issue, {
      iteration: context.issue.iteration,
      phase,
      action: successEntry("orchestrationRunning"),
    });
  }

  return [tree];
};

/**
 * orchestrationWaiting: Waiting for review on current phase.
 * No structural changes expected.
 */
export const orchestrationWaitingMutator: StateMutator = (current) => {
  return [cloneTree(current)];
};

/**
 * orchestrationComplete: All phases done.
 * Parent → Done + CLOSED, history: All phases complete.
 */
export const orchestrationCompleteMutator: StateMutator = (
  current,
  context,
) => {
  const tree = cloneTree(current);
  tree.issue.projectStatus = "Done";
  tree.issue.state = "CLOSED";
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration,
    phase: "-",
    action: HISTORY_MESSAGES.ALL_PHASES_COMPLETE,
  });
  return [tree];
};
