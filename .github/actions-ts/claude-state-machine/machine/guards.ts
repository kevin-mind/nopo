import type { MachineContext } from "../schemas/index.js";
import { isTerminalStatus } from "../schemas/index.js";

/**
 * Guard context type for XState
 */
export interface GuardContext {
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
export function needsSubIssues({ context }: GuardContext): boolean {
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
    return context.issue.subIssues.length === 0 &&
           context.currentSubIssue === null;
  }

  // Multi-phase: check all sub-issues
  return context.issue.subIssues.every(
    (s) => s.projectStatus === "Done" || s.state === "CLOSED",
  );
}

// ============================================================================
// Phase State Guards
// ============================================================================

/**
 * Check if current phase is in review state
 */
export function isInReview({ context }: GuardContext): boolean {
  if (context.currentSubIssue) {
    return context.currentSubIssue.projectStatus === "Review";
  }
  return context.issue.projectStatus === "Review";
}

/**
 * Check if current phase needs work
 */
export function currentPhaseNeedsWork({ context }: GuardContext): boolean {
  if (context.currentSubIssue) {
    const status = context.currentSubIssue.projectStatus;
    return status === "Working" || status === "Ready";
  }
  return context.issue.projectStatus === "Working" ||
         context.issue.projectStatus === "In Progress";
}

/**
 * Check if current phase is in review
 */
export function currentPhaseInReview({ context }: GuardContext): boolean {
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
  // For non-sub-issue work, we need to check the issue body
  // This would need the issue's own todos parsed
  return false;
}

/**
 * Check if there are uncompleted todos
 */
export function hasPendingTodos({ context }: GuardContext): boolean {
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
export function triggeredByReviewRequest({ context }: GuardContext): boolean {
  return context.trigger === "pr_review_requested";
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
  // Composite guards
  readyForReview,
  shouldContinueIterating,
  shouldBlock,
};

export type GuardName = keyof typeof guards;
