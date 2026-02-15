/**
 * Logging state mutators.
 *
 * Handle merge queue, merge, and deployment logging states.
 * These only add history entries — no structural changes.
 */

import type { StateMutator } from "./types.js";
import { HISTORY_MESSAGES } from "../../../../core/constants.js";
import { cloneTree, addHistoryEntry } from "./helpers.js";

function makeLoggingMutator(message: string): StateMutator {
  return (current, context) => {
    const tree = cloneTree(current);
    const phase = String(context.currentPhase ?? "-");
    addHistoryEntry(tree.issue, {
      iteration: context.issue.iteration ?? 0,
      phase,
      action: message,
    });
    return [tree];
  };
}

export const mergeQueueLoggingMutator = makeLoggingMutator(
  HISTORY_MESSAGES.ENTERED_QUEUE,
);

export const mergeQueueFailureLoggingMutator = makeLoggingMutator(
  HISTORY_MESSAGES.REMOVED_FROM_QUEUE,
);

export const mergedLoggingMutator = makeLoggingMutator(HISTORY_MESSAGES.MERGED);

export const deployedStageLoggingMutator = makeLoggingMutator(
  HISTORY_MESSAGES.DEPLOYED_STAGE,
);

export const deployedProdLoggingMutator = makeLoggingMutator(
  HISTORY_MESSAGES.RELEASED_PROD,
);

export const deployedStageFailureLoggingMutator = makeLoggingMutator(
  HISTORY_MESSAGES.STAGE_DEPLOY_FAILED,
);

export const deployedProdFailureLoggingMutator = makeLoggingMutator(
  HISTORY_MESSAGES.PROD_DEPLOY_FAILED,
);
