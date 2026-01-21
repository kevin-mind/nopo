import type {
  MachineContext,
  Action,
  ProjectStatus,
} from "../schemas/index.js";
import { deriveBranchName } from "../parser/index.js";

/**
 * Action context type for XState actions
 */
export interface ActionContext {
  context: MachineContext;
}

/**
 * Action result - actions to execute
 */
export type ActionResult = Action[];

/**
 * Accumulated actions during machine execution
 * XState will collect these via assign
 */
export interface ActionsAccumulator {
  actions: Action[];
}

// ============================================================================
// Project Status Actions
// ============================================================================

/**
 * Emit action to set status to Working
 */
export function emitSetWorking({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  return [
    {
      type: "updateProjectStatus",
      issueNumber,
      status: "Working" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set status to Review
 */
export function emitSetReview({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  return [
    {
      type: "updateProjectStatus",
      issueNumber,
      status: "Review" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set parent status to In Progress
 */
export function emitSetInProgress({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      issueNumber: context.issue.number,
      status: "In Progress" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set status to Done
 */
export function emitSetDone({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      issueNumber: context.issue.number,
      status: "Done" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set status to Blocked
 */
export function emitSetBlocked({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      issueNumber: context.issue.number,
      status: "Blocked" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set status to Error
 */
export function emitSetError({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      issueNumber: context.issue.number,
      status: "Error" as ProjectStatus,
    },
  ];
}

// ============================================================================
// Iteration/Failure Actions
// ============================================================================

/**
 * Emit action to increment iteration counter
 */
export function emitIncrementIteration({
  context,
}: ActionContext): ActionResult {
  return [
    {
      type: "incrementIteration",
      issueNumber: context.issue.number,
    },
  ];
}

/**
 * Emit action to record a failure
 */
export function emitRecordFailure({ context }: ActionContext): ActionResult {
  return [
    {
      type: "recordFailure",
      issueNumber: context.issue.number,
      failureType: "ci" as const,
    },
  ];
}

/**
 * Emit action to clear failures
 */
export function emitClearFailures({ context }: ActionContext): ActionResult {
  return [
    {
      type: "clearFailures",
      issueNumber: context.issue.number,
    },
  ];
}

// ============================================================================
// Issue Actions
// ============================================================================

/**
 * Emit action to close the issue
 */
export function emitCloseIssue({ context }: ActionContext): ActionResult {
  return [
    {
      type: "closeIssue",
      issueNumber: context.issue.number,
      reason: "completed" as const,
    },
  ];
}

/**
 * Emit action to close current sub-issue
 */
export function emitCloseSubIssue({ context }: ActionContext): ActionResult {
  if (!context.currentSubIssue) {
    return [];
  }
  return [
    {
      type: "closeIssue",
      issueNumber: context.currentSubIssue.number,
      reason: "completed" as const,
    },
  ];
}

/**
 * Emit action to unassign bot from issue
 */
export function emitUnassign({ context }: ActionContext): ActionResult {
  return [
    {
      type: "unassignUser",
      issueNumber: context.issue.number,
      username: context.botUsername,
    },
  ];
}

/**
 * Emit action to block the issue
 */
export function emitBlock({ context }: ActionContext): ActionResult {
  return [
    {
      type: "block",
      issueNumber: context.issue.number,
      reason: `Max failures (${context.maxRetries}) reached`,
    },
  ];
}

// ============================================================================
// History Actions
// ============================================================================

/**
 * Emit action to append to iteration history
 */
export function emitAppendHistory(
  { context }: ActionContext,
  message: string,
  phase?: string | number,
): ActionResult {
  const phaseStr = phase ?? context.currentPhase ?? "-";
  return [
    {
      type: "appendHistory",
      issueNumber: context.issue.number,
      phase: String(phaseStr),
      message,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

/**
 * Emit action to log CI start
 */
export function emitLogCIStart({ context }: ActionContext): ActionResult {
  return emitAppendHistory({ context }, "⏳ CI Running...");
}

/**
 * Emit action to log CI success
 */
export function emitLogCISuccess({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateHistory",
      issueNumber: context.issue.number,
      matchIteration: context.issue.iteration,
      matchPhase: String(context.currentPhase ?? "-"),
      matchPattern: "⏳",
      newMessage: "✅ CI Passed",
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

/**
 * Emit action to log CI failure
 */
export function emitLogCIFailure({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateHistory",
      issueNumber: context.issue.number,
      matchIteration: context.issue.iteration,
      matchPhase: String(context.currentPhase ?? "-"),
      matchPattern: "⏳",
      newMessage: "❌ CI Failed",
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

// ============================================================================
// Git/Branch Actions
// ============================================================================

/**
 * Emit action to create branch
 */
export function emitCreateBranch({ context }: ActionContext): ActionResult {
  const branchName =
    context.branch ??
    deriveBranchName(context.issue.number, context.currentPhase ?? undefined);
  return [
    {
      type: "createBranch",
      branchName,
      baseBranch: "main",
    },
  ];
}

// ============================================================================
// PR Actions
// ============================================================================

/**
 * Emit action to create PR
 */
export function emitCreatePR({ context }: ActionContext): ActionResult {
  const branchName =
    context.branch ??
    deriveBranchName(context.issue.number, context.currentPhase ?? undefined);
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;

  return [
    {
      type: "createPR",
      title: context.currentSubIssue?.title ?? context.issue.title,
      body: `Fixes #${issueNumber}`,
      branchName,
      baseBranch: "main",
      draft: true,
      issueNumber,
    },
  ];
}

/**
 * Emit action to mark PR as ready for review
 */
export function emitMarkReady({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "markPRReady",
      prNumber: context.pr.number,
    },
  ];
}

/**
 * Emit action to convert PR to draft
 */
export function emitConvertToDraft({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "convertPRToDraft",
      prNumber: context.pr.number,
    },
  ];
}

/**
 * Emit action to request review
 */
export function emitRequestReview({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "requestReview",
      prNumber: context.pr.number,
      reviewer: context.botUsername,
    },
  ];
}

/**
 * Emit action to merge PR
 */
export function emitMergePR({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "mergePR",
      prNumber: context.pr.number,
      mergeMethod: "squash" as const,
    },
  ];
}

// ============================================================================
// Claude Actions
// ============================================================================

/**
 * Emit action to run Claude for implementation
 */
export function emitRunClaude({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const branchName =
    context.branch ??
    deriveBranchName(context.issue.number, context.currentPhase ?? undefined);

  const prompt = `Implement the requirements for issue #${issueNumber}.
Work on branch ${branchName}.
Ensure all tests pass before pushing.`;

  return [
    {
      type: "runClaude",
      prompt,
      issueNumber,
      worktree: context.branch ?? undefined,
    },
  ];
}

/**
 * Emit action to run Claude for CI fix
 */
export function emitRunClaudeFixCI({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;

  const prompt = `Fix the CI failures for issue #${issueNumber}.
CI run: ${context.ciRunUrl ?? "N/A"}
Commit: ${context.ciCommitSha ?? "N/A"}

Review the CI logs and fix the failing tests or build errors.`;

  return [
    {
      type: "runClaude",
      prompt,
      issueNumber,
      worktree: context.branch ?? undefined,
    },
  ];
}

/**
 * Emit action to run Claude for review response
 */
export function emitRunClaudeReviewResponse({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;

  const prompt = `Address the review feedback for issue #${issueNumber}.
Review decision: ${context.reviewDecision ?? "N/A"}
Reviewer: ${context.reviewerId ?? "N/A"}

Make the requested changes and push the updates.`;

  return [
    {
      type: "runClaude",
      prompt,
      issueNumber,
      worktree: context.branch ?? undefined,
    },
  ];
}

// ============================================================================
// Control Flow Actions
// ============================================================================

/**
 * Emit stop action
 */
export function emitStop(_ctx: ActionContext, reason: string): ActionResult {
  return [
    {
      type: "stop",
      reason,
    },
  ];
}

/**
 * Emit log action
 */
export function emitLog(
  _ctx: ActionContext,
  message: string,
  level: "debug" | "info" | "warning" | "error" = "info",
): ActionResult {
  return [
    {
      type: "log",
      level,
      message,
    },
  ];
}

/**
 * Emit no-op action
 */
export function emitNoOp(_ctx: ActionContext, reason?: string): ActionResult {
  return [
    {
      type: "noop",
      reason,
    },
  ];
}

// ============================================================================
// Compound Actions
// ============================================================================

/**
 * Emit actions for transitioning to review state
 */
export function emitTransitionToReview({
  context,
}: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Clear failures on success
  if (context.issue.failures > 0) {
    actions.push(...emitClearFailures({ context }));
  }

  // Mark PR ready
  if (context.pr?.isDraft) {
    actions.push(...emitMarkReady({ context }));
  }

  // Set status to Review
  actions.push(...emitSetReview({ context }));

  // Request review
  actions.push(...emitRequestReview({ context }));

  return actions;
}

/**
 * Emit actions for handling CI failure
 */
export function emitHandleCIFailure({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Record the failure
  actions.push(...emitRecordFailure({ context }));

  // Log the failure
  actions.push(...emitLogCIFailure({ context }));

  return actions;
}

/**
 * Emit actions for blocking the issue
 */
export function emitBlockIssue({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Set status to Blocked
  actions.push(...emitSetBlocked({ context }));

  // Unassign bot
  actions.push(...emitUnassign({ context }));

  // Log
  actions.push(
    ...emitAppendHistory(
      { context },
      `🚫 Blocked: Max failures reached (${context.issue.failures})`,
    ),
  );

  // Block action
  actions.push(...emitBlock({ context }));

  return actions;
}

/**
 * Export all action emitters as a record for XState
 */
export const machineActions = {
  // Project status
  emitSetWorking,
  emitSetReview,
  emitSetInProgress,
  emitSetDone,
  emitSetBlocked,
  emitSetError,
  // Iteration/failure
  emitIncrementIteration,
  emitRecordFailure,
  emitClearFailures,
  // Issue
  emitCloseIssue,
  emitCloseSubIssue,
  emitUnassign,
  emitBlock,
  // History
  emitAppendHistory,
  emitLogCIStart,
  emitLogCISuccess,
  emitLogCIFailure,
  // Git/branch
  emitCreateBranch,
  // PR
  emitCreatePR,
  emitMarkReady,
  emitConvertToDraft,
  emitRequestReview,
  emitMergePR,
  // Claude
  emitRunClaude,
  emitRunClaudeFixCI,
  emitRunClaudeReviewResponse,
  // Control flow
  emitStop,
  emitLog,
  emitNoOp,
  // Compound
  emitTransitionToReview,
  emitHandleCIFailure,
  emitBlockIssue,
};

export type MachineActionName = keyof typeof machineActions;
