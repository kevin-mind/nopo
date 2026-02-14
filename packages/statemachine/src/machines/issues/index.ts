// Issue automation state machine

export { issueMachine } from "./machine.js";
/** @deprecated Use issueMachine instead */
export { issueMachine as claudeMachine } from "./machine.js";
export { STATES } from "./states.js";
export type { IssueState as IssueMachineState } from "./states.js";
export { guards } from "./guards.js";
export { getTriggerEvent, type IssueMachineEvent } from "./events.js";

// Re-export core helpers
export { emitLog } from "../../core/action-helpers.js";

// Re-export individual guards for direct testing
export {
  isAlreadyDone,
  isBlocked,
  isError,
  isTerminal,
  hasSubIssues,
  isSubIssue,
  subIssueCanIterate,
  needsSubIssues,
  allPhasesDone,
  needsParentInit,
  currentPhaseComplete,
  hasNextPhase,
  subIssueNeedsAssignment,
  isInReview,
  currentPhaseNeedsWork,
  currentPhaseInReview,
  todosDone,
  hasPendingTodos,
  ciPassed,
  ciFailed,
  ciCancelled,
  maxFailuresReached,
  hasFailures,
  reviewApproved,
  reviewRequestedChanges,
  reviewCommented,
  hasPR,
  prIsDraft,
  prIsReady,
  prIsMerged,
  hasBranch,
  needsBranch,
  botIsAssigned,
  isFirstIteration,
  triggeredByAssignment,
  triggeredByEdit,
  triggeredByCI,
  triggeredByReview,
  triggeredByReviewRequest,
  triggeredByTriage,
  triggeredByComment,
  triggeredByOrchestrate,
  triggeredByPRReview,
  triggeredByPRResponse,
  triggeredByPRHumanResponse,
  triggeredByPRReviewApproved,
  triggeredByPRPush,
  triggeredByReset,
  triggeredByRetry,
  triggeredByPivot,
  triggeredByMergeQueueEntry,
  triggeredByMergeQueueFailure,
  triggeredByPRMerged,
  triggeredByDeployedStage,
  triggeredByDeployedProd,
  triggeredByDeployedStageFailure,
  triggeredByDeployedProdFailure,
  needsTriage,
  isTriaged,
  triggeredByGroom,
  triggeredByGroomSummary,
  needsGrooming,
  isGroomed,
  needsInfo,
  readyForReview,
  shouldContinueIterating,
  shouldBlock,
} from "./guards.js";

// Re-export history/status helpers
export { emitStatus, emitAppendHistory, emitUpdateHistory } from "./actions.js";

// Re-export compound/complex action helpers
export {
  transitionToReview,
  handleCIFailure,
  blockIssue,
  orchestrate,
  allPhasesDone as allPhasesDoneActions,
  resetIssue,
  retryIssue,
  pushToDraft,
  logInvalidIteration,
  runClaude,
  runClaudeFixCI,
  runClaudeTriage,
  runClaudeComment,
  runClaudePRReview,
  runClaudePRResponse,
  runClaudePRHumanResponse,
  runClaudeGrooming,
  runClaudePivot,
  mergeQueueEntry,
  mergeQueueFailure,
  merged,
  deployedStage,
  deployedProd,
  deployedStageFailure,
  deployedProdFailure,
} from "./actions.js";
