import type { MachineContext } from "../schemas/index.js";
import { isTerminalStatus } from "../schemas/index.js";

/**
 * Guard context type for XState
 */
interface GuardContext {
  context: MachineContext;
}

// ============================================================================
// Terminal State Guards
// ============================================================================

/**
 * Check if the issue is already done
 */
export function isAlreadyDone({ context }: GuardContext): boolean {
  return context.issue.projectStatus === "Done";
}

/**
 * Check if the issue is blocked
 */
export function isBlocked({ context }: GuardContext): boolean {
  return context.issue.projectStatus === "Blocked";
}

/**
 * Check if the issue has an error
 */
export function isError({ context }: GuardContext): boolean {
  return context.issue.projectStatus === "Error";
}

/**
 * Check if the issue is in a terminal state (no work to do)
 */
export function isTerminal({ context }: GuardContext): boolean {
  const status = context.issue.projectStatus;
  return status !== null && isTerminalStatus(status);
}

// ============================================================================
// Sub-Issue Guards
// ============================================================================

/**
 * Check if the issue has sub-issues
 */
export function hasSubIssues({ context }: GuardContext): boolean {
  return context.issue.hasSubIssues;
}

/**
 * Check if the issue needs sub-issues created
 * (This would be determined by issue content/labels - placeholder for now)
 */
export function needsSubIssues(_guardContext: GuardContext): boolean {
  // For now, we don't auto-create sub-issues
  // This could check for specific labels or issue content
  return false;
}

/**
 * Check if all phases are done
 */
export function allPhasesDone({ context }: GuardContext): boolean {
  if (!context.issue.hasSubIssues) {
    // Single-phase: check todos
    return (
      context.issue.subIssues.length === 0 && context.currentSubIssue === null
    );
  }

  // Multi-phase: check all sub-issues
  return context.issue.subIssues.every(
    (s) => s.projectStatus === "Done" || s.state === "CLOSED",
  );
}

// ============================================================================
// Orchestration Guards
// ============================================================================

/**
 * Check if parent issue needs initialization (status is Backlog or null)
 */
function needsParentInit({ context }: GuardContext): boolean {
  return (
    context.issue.hasSubIssues &&
    (context.issue.projectStatus === null ||
      context.issue.projectStatus === "Backlog")
  );
}

/**
 * Check if current phase is complete (todos done) and ready to advance
 * This means the current sub-issue's work is done and we should move to next phase
 */
function currentPhaseComplete({ context }: GuardContext): boolean {
  if (!context.currentSubIssue) {
    return false;
  }
  // Phase is complete when todos are done
  return context.currentSubIssue.todos.uncheckedNonManual === 0;
}

/**
 * Check if there is a next phase after the current one
 */
function hasNextPhase({ context }: GuardContext): boolean {
  if (!context.issue.hasSubIssues || context.currentPhase === null) {
    return false;
  }
  return context.currentPhase < context.totalPhases;
}

/**
 * Check if current sub-issue needs assignment (nopo-bot not assigned)
 */
function subIssueNeedsAssignment({ context }: GuardContext): boolean {
  // Can't check sub-issue assignees directly from parent context
  // The assignment is always needed as the orchestrate workflow will handle
  // re-assignment if already assigned
  return context.currentSubIssue !== null;
}

// ============================================================================
// Phase State Guards
// ============================================================================

/**
 * Check if current phase is in review state
 */
export function isInReview({ context }: GuardContext): boolean {
  if (context.currentSubIssue) {
    return context.currentSubIssue.projectStatus === "In review";
  }
  return context.issue.projectStatus === "In review";
}

/**
 * Check if current phase needs work
 */
export function currentPhaseNeedsWork({ context }: GuardContext): boolean {
  if (context.currentSubIssue) {
    const status = context.currentSubIssue.projectStatus;
    return status === "In progress" || status === "Ready";
  }
  return context.issue.projectStatus === "In progress";
}

/**
 * Check if current phase is in review
 */
function currentPhaseInReview({ context }: GuardContext): boolean {
  return isInReview({ context });
}

// ============================================================================
// Todo Guards
// ============================================================================

/**
 * Check if all non-manual todos are done for current phase
 */
export function todosDone({ context }: GuardContext): boolean {
  if (context.currentSubIssue) {
    return context.currentSubIssue.todos.uncheckedNonManual === 0;
  }
  // When triggered directly on a sub-issue (e.g., CI completion),
  // currentSubIssue is null but the issue itself has todos
  return context.issue.todos.uncheckedNonManual === 0;
}

/**
 * Check if there are uncompleted todos
 */
function hasPendingTodos({ context }: GuardContext): boolean {
  return !todosDone({ context });
}

// ============================================================================
// CI Guards
// ============================================================================

/**
 * Check if CI passed
 */
export function ciPassed({ context }: GuardContext): boolean {
  return context.ciResult === "success";
}

/**
 * Check if CI failed
 */
export function ciFailed({ context }: GuardContext): boolean {
  return context.ciResult === "failure";
}

/**
 * Check if CI was cancelled
 */
export function ciCancelled({ context }: GuardContext): boolean {
  return context.ciResult === "cancelled";
}

// ============================================================================
// Failure Guards
// ============================================================================

/**
 * Check if max failures reached (circuit breaker)
 */
export function maxFailuresReached({ context }: GuardContext): boolean {
  return context.issue.failures >= context.maxRetries;
}

/**
 * Check if there have been any failures
 */
export function hasFailures({ context }: GuardContext): boolean {
  return context.issue.failures > 0;
}

// ============================================================================
// Review Guards
// ============================================================================

/**
 * Check if review was approved
 */
export function reviewApproved({ context }: GuardContext): boolean {
  return context.reviewDecision === "APPROVED";
}

/**
 * Check if review requested changes
 */
export function reviewRequestedChanges({ context }: GuardContext): boolean {
  return context.reviewDecision === "CHANGES_REQUESTED";
}

/**
 * Check if review just commented (no decision)
 */
export function reviewCommented({ context }: GuardContext): boolean {
  return context.reviewDecision === "COMMENTED";
}

// ============================================================================
// PR Guards
// ============================================================================

/**
 * Check if there is an open PR
 */
export function hasPR({ context }: GuardContext): boolean {
  return context.hasPR && context.pr !== null;
}

/**
 * Check if PR is a draft
 */
export function prIsDraft({ context }: GuardContext): boolean {
  return context.pr?.isDraft === true;
}

/**
 * Check if PR is ready for review (not draft)
 */
export function prIsReady({ context }: GuardContext): boolean {
  return context.pr !== null && !context.pr.isDraft;
}

/**
 * Check if PR is merged
 */
export function prIsMerged({ context }: GuardContext): boolean {
  return context.pr?.state === "MERGED";
}

// ============================================================================
// Branch Guards
// ============================================================================

/**
 * Check if the branch exists
 */
export function hasBranch({ context }: GuardContext): boolean {
  return context.hasBranch;
}

/**
 * Check if branch needs to be created
 */
export function needsBranch({ context }: GuardContext): boolean {
  return !context.hasBranch && context.branch !== null;
}

// ============================================================================
// Assignment Guards
// ============================================================================

/**
 * Check if bot is assigned to the issue
 */
export function botIsAssigned({ context }: GuardContext): boolean {
  return context.issue.assignees.includes(context.botUsername);
}

/**
 * Check if this is first iteration
 */
export function isFirstIteration({ context }: GuardContext): boolean {
  return context.issue.iteration === 0;
}

// ============================================================================
// Trigger Guards
// ============================================================================

/**
 * Check if triggered by issue assignment
 */
export function triggeredByAssignment({ context }: GuardContext): boolean {
  return context.trigger === "issue_assigned";
}

/**
 * Check if triggered by issue edit
 */
export function triggeredByEdit({ context }: GuardContext): boolean {
  return context.trigger === "issue_edited";
}

/**
 * Check if triggered by CI completion
 */
export function triggeredByCI({ context }: GuardContext): boolean {
  return context.trigger === "workflow_run_completed";
}

/**
 * Check if triggered by review submission
 */
export function triggeredByReview({ context }: GuardContext): boolean {
  return context.trigger === "pr_review_submitted";
}

/**
 * Check if triggered by review request
 */
function triggeredByReviewRequest({ context }: GuardContext): boolean {
  return context.trigger === "pr_review_requested";
}

/**
 * Check if triggered by triage request
 */
export function triggeredByTriage({ context }: GuardContext): boolean {
  return context.trigger === "issue_triage";
}

/**
 * Check if triggered by issue comment (@claude mention)
 */
function triggeredByComment({ context }: GuardContext): boolean {
  return context.trigger === "issue_comment";
}

/**
 * Check if triggered by orchestration request
 */
function triggeredByOrchestrate({ context }: GuardContext): boolean {
  return context.trigger === "issue_orchestrate";
}

/**
 * Check if triggered by PR review request (bot should review the PR)
 */
function triggeredByPRReview({ context }: GuardContext): boolean {
  return context.trigger === "pr_review";
}

/**
 * Check if triggered by PR response (bot should respond to bot's review)
 */
function triggeredByPRResponse({ context }: GuardContext): boolean {
  return context.trigger === "pr_response";
}

/**
 * Check if triggered by PR human response (bot should respond to human's review)
 */
function triggeredByPRHumanResponse({ context }: GuardContext): boolean {
  return context.trigger === "pr_human_response";
}

// ============================================================================
// Triage Guards
// ============================================================================

/**
 * Check if the issue needs triage (doesn't have "triaged" label)
 */
function needsTriage({ context }: GuardContext): boolean {
  return !context.issue.labels.includes("triaged");
}

/**
 * Check if the issue has been triaged (has "triaged" label)
 */
function isTriaged({ context }: GuardContext): boolean {
  return context.issue.labels.includes("triaged");
}

// ============================================================================
// Composite Guards
// ============================================================================

/**
 * Check if ready to transition to review (CI passed and todos done)
 */
export function readyForReview({ context }: GuardContext): boolean {
  return ciPassed({ context }) && todosDone({ context });
}

/**
 * Check if should continue iterating (CI failed but not blocked)
 */
export function shouldContinueIterating({ context }: GuardContext): boolean {
  return ciFailed({ context }) && !maxFailuresReached({ context });
}

/**
 * Check if should be blocked (CI failed and max retries reached)
 */
export function shouldBlock({ context }: GuardContext): boolean {
  return ciFailed({ context }) && maxFailuresReached({ context });
}

/**
 * Export all guards as a record for XState
 */
export const guards = {
  // Terminal state guards
  isAlreadyDone,
  isBlocked,
  isError,
  isTerminal,
  // Sub-issue guards
  hasSubIssues,
  needsSubIssues,
  allPhasesDone,
  // Orchestration guards
  needsParentInit,
  currentPhaseComplete,
  hasNextPhase,
  subIssueNeedsAssignment,
  // Phase state guards
  isInReview,
  currentPhaseNeedsWork,
  currentPhaseInReview,
  // Todo guards
  todosDone,
  hasPendingTodos,
  // CI guards
  ciPassed,
  ciFailed,
  ciCancelled,
  // Failure guards
  maxFailuresReached,
  hasFailures,
  // Review guards
  reviewApproved,
  reviewRequestedChanges,
  reviewCommented,
  // PR guards
  hasPR,
  prIsDraft,
  prIsReady,
  prIsMerged,
  // Branch guards
  hasBranch,
  needsBranch,
  // Assignment guards
  botIsAssigned,
  isFirstIteration,
  // Trigger guards
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
  // Triage guards
  needsTriage,
  isTriaged,
  // Composite guards
  readyForReview,
  shouldContinueIterating,
  shouldBlock,
};
