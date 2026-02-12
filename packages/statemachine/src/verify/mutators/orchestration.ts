/**
 * Orchestration state mutators.
 *
 * Handle orchestrationRunning, orchestrationWaiting, orchestrationComplete states.
 */

import type { StateMutator } from "./types.js";
import { HISTORY_MESSAGES } from "../../constants.js";
import { cloneTree, addHistoryEntry } from "./helpers.js";

/**
 * orchestrationRunning: Emit orchestration actions.
 * Orchestration does NOT update project statuses — those happen in iteration.
 * Only structural effects: history entries, assignments.
 */
export const orchestrationRunningMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);

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
