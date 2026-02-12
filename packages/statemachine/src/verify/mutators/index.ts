/**
 * Mutator registry.
 *
 * Maps final state names to their StateMutator functions.
 */

export type { StateMutator } from "./types.js";

import type { StateMutator } from "./types.js";
import {
  doneMutator,
  blockedMutator,
  errorMutator,
  noopMutator,
} from "./terminal.js";
import { iteratingMutator, iteratingFixMutator } from "./iteration.js";
import {
  reviewingMutator,
  transitioningToReviewMutator,
  awaitingMergeMutator,
} from "./review.js";
import {
  orchestrationRunningMutator,
  orchestrationWaitingMutator,
  orchestrationCompleteMutator,
} from "./orchestration.js";
import {
  triagingMutator,
  groomingMutator,
  commentingMutator,
  pivotingMutator,
} from "./ai-dependent.js";
import {
  mergeQueueLoggingMutator,
  mergeQueueFailureLoggingMutator,
  mergedLoggingMutator,
  deployedStageLoggingMutator,
  deployedProdLoggingMutator,
  deployedStageFailureLoggingMutator,
  deployedProdFailureLoggingMutator,
} from "./logging.js";
import {
  processingCIMutator,
  prPushMutator,
  resettingMutator,
  processingMergeMutator,
  invalidIterationMutator,
  subIssueIdleMutator,
} from "./control.js";

/**
 * Registry of state name → mutator function.
 */
const MUTATOR_REGISTRY: Record<string, StateMutator> = {
  // Terminal
  done: doneMutator,
  blocked: blockedMutator,
  error: errorMutator,
  alreadyDone: noopMutator,
  alreadyBlocked: noopMutator,

  // Iteration
  iterating: iteratingMutator,
  iteratingFix: iteratingFixMutator,

  // Review
  reviewing: reviewingMutator,
  transitioningToReview: transitioningToReviewMutator,
  awaitingMerge: awaitingMergeMutator,

  // Orchestration
  orchestrationRunning: orchestrationRunningMutator,
  orchestrationWaiting: orchestrationWaitingMutator,
  orchestrationComplete: orchestrationCompleteMutator,

  // AI-dependent
  triaging: triagingMutator,
  grooming: groomingMutator,
  commenting: commentingMutator,
  pivoting: pivotingMutator,

  // Logging
  mergeQueueLogging: mergeQueueLoggingMutator,
  mergeQueueFailureLogging: mergeQueueFailureLoggingMutator,
  mergedLogging: mergedLoggingMutator,
  deployedStageLogging: deployedStageLoggingMutator,
  deployedProdLogging: deployedProdLoggingMutator,
  deployedStageFailureLogging: deployedStageFailureLoggingMutator,
  deployedProdFailureLogging: deployedProdFailureLoggingMutator,

  // Control
  processingCI: processingCIMutator,
  prPush: prPushMutator,
  resetting: resettingMutator,
  processingMerge: processingMergeMutator,
  invalidIteration: invalidIterationMutator,
  subIssueIdle: subIssueIdleMutator,

  // PR review states (AI-dependent, no predictable structural changes)
  prReviewing: noopMutator,
  prResponding: noopMutator,
  prRespondingHuman: noopMutator,
  prReviewSkipped: noopMutator,
};

/**
 * Get the mutator for a given final state.
 * Returns undefined if no mutator is registered for the state.
 */
export function getMutator(finalState: string): StateMutator | undefined {
  return MUTATOR_REGISTRY[finalState];
}

/**
 * Check if a mutator exists for a given state.
 */
export function hasMutator(finalState: string): boolean {
  return finalState in MUTATOR_REGISTRY;
}
