/**
 * Terminal state mutators.
 *
 * These handle final states that end the machine (done, blocked, error, etc.)
 */

import type { StateMutator } from "./types.js";
import { HISTORY_MESSAGES } from "../../constants.js";
import { cloneTree, addHistoryEntry } from "./helpers.js";

/**
 * done: Set issue to Done and CLOSED.
 */
export const doneMutator: StateMutator = (current) => {
  const tree = cloneTree(current);
  tree.issue.projectStatus = "Done";
  tree.issue.state = "CLOSED";
  return [tree];
};

/**
 * blocked: Set issue to Blocked, remove bot from assignees.
 * History: adds blocked entry.
 */
export const blockedMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  tree.issue.projectStatus = "Blocked";
  tree.issue.assignees = tree.issue.assignees.filter(
    (a) => a !== context.botUsername,
  );
  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration,
    phase,
    action: HISTORY_MESSAGES.blocked(context.issue.failures),
  });
  return [tree];
};

/**
 * error: Set issue to Error status.
 */
export const errorMutator: StateMutator = (current) => {
  const tree = cloneTree(current);
  tree.issue.projectStatus = "Error";
  return [tree];
};

/**
 * alreadyDone / alreadyBlocked: No changes expected (already terminal).
 */
export const noopMutator: StateMutator = (current) => {
  return [cloneTree(current)];
};
