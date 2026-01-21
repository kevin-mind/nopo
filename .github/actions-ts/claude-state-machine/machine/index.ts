// Guards
export { guards, type GuardContext, type GuardName } from "./guards.js";

// Actions
export {
  machineActions,
  type ActionContext,
  type ActionResult,
  type ActionsAccumulator,
  type MachineActionName,
  // Individual action emitters
  emitSetWorking,
  emitSetReview,
  emitSetInProgress,
  emitSetDone,
  emitSetBlocked,
  emitSetError,
  emitIncrementIteration,
  emitRecordFailure,
  emitClearFailures,
  emitCloseIssue,
  emitCloseSubIssue,
  emitUnassign,
  emitBlock,
  emitAppendHistory,
  emitLogCIStart,
  emitLogCISuccess,
  emitLogCIFailure,
  emitCreateBranch,
  emitCreatePR,
  emitMarkReady,
  emitConvertToDraft,
  emitRequestReview,
  emitMergePR,
  emitRunClaude,
  emitRunClaudeFixCI,
  emitRunClaudeReviewResponse,
  emitStop,
  emitLog,
  emitNoOp,
  emitTransitionToReview,
  emitHandleCIFailure,
  emitBlockIssue,
} from "./actions.js";

// Machine
export {
  claudeMachine,
  getTriggerEvent,
  type MachineContextWithActions,
  type MachineEvent,
  type MachineOutput,
  type ClaudeMachine,
} from "./machine.js";
