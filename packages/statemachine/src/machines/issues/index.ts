// Issue automation state machine — invoke-based approach

export { issueInvokeMachine, IssueMachine } from "./machine.js";
export type {
  InvokeMachineContext,
  MachineResult,
  RunOptions,
  ExecuteOptions,
  ExecuteResult,
} from "./machine.js";
export { buildActionsForService, createDefaultServices } from "./services.js";
export type { ServiceInput, ServiceOutput } from "./services.js";
export {
  ContextLoader,
  buildDeriveMetadata,
  buildEventFromWorkflow,
  deriveFromWorkflow,
  deriveIssueActions,
  getTransitionName,
} from "./context.js";
export type {
  ContextLoaderOptions,
  DeriveMetadata,
  DeriveResult,
  DeriveIssueOptions,
  WorkflowEventFields,
} from "./context.js";
export { MachineVerifier } from "./verifier.js";
export type { VerificationResult } from "./verifier.js";

// Re-export shared pieces
export { STATES } from "./states.js";
// IssueState exported via STATES type inference; not re-exported to avoid
// conflict with @more/issue-state's IssueState at the barrel level.
// Import directly from ./states.js if needed.
export { guards } from "./guards.js";
export { getTriggerEvent, type IssueMachineEvent } from "./events.js";

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

// Verification infrastructure
export * as Verify from "./verify/index.js";
