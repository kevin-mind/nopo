/**
 * All states in the issue automation state machine.
 *
 * Frozen const object for type-safe state references throughout the codebase.
 */

export const STATES = {
  // Initial detection
  detecting: "detecting",

  // Triage flow
  triaging: "triaging",

  // Grooming flow
  grooming: "grooming",

  // Pivot flow
  pivoting: "pivoting",

  // Reset flow
  resetting: "resetting",

  // Retry flow
  retrying: "retrying",

  // Comment flow
  commenting: "commenting",

  // PR review flows
  prReviewing: "prReviewing",
  prResponding: "prResponding",
  prRespondingHuman: "prRespondingHuman",
  prReviewSkipped: "prReviewSkipped",
  prReviewAssigned: "prReviewAssigned",
  prPush: "prPush",

  // Orchestration flows
  initializing: "initializing",
  orchestrating: "orchestrating",
  orchestrationRunning: "orchestrationRunning",
  orchestrationWaiting: "orchestrationWaiting",
  orchestrationComplete: "orchestrationComplete",

  // CI/merge/review processing
  processingCI: "processingCI",
  processingMerge: "processingMerge",
  processingReview: "processingReview",

  // Iteration flows
  iterating: "iterating",
  iteratingFix: "iteratingFix",

  // Review/transition flows
  reviewing: "reviewing",
  transitioningToReview: "transitioningToReview",
  awaitingMerge: "awaitingMerge",

  // Terminal states
  blocked: "blocked",
  alreadyBlocked: "alreadyBlocked",
  error: "error",
  done: "done",

  // Sub-issue idle (bot not assigned)
  subIssueIdle: "subIssueIdle",

  // Invalid iteration (parent without sub-issues)
  invalidIteration: "invalidIteration",

  // Merge queue logging states
  mergeQueueLogging: "mergeQueueLogging",
  mergeQueueFailureLogging: "mergeQueueFailureLogging",
  mergedLogging: "mergedLogging",
  deployedStageLogging: "deployedStageLogging",
  deployedProdLogging: "deployedProdLogging",
  deployedStageFailureLogging: "deployedStageFailureLogging",
  deployedProdFailureLogging: "deployedProdFailureLogging",
} as const;

export type IssueState = (typeof STATES)[keyof typeof STATES];
