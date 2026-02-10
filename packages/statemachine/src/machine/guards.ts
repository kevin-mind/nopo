import type { MachineContext } from "../schemas/index.js";
import { isTerminalStatus } from "../schemas/index.js";
import {
  extractTodosFromAst,
  extractQuestionsFromAst,
} from "../parser/index.js";

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
 *
 * Returns true ONLY if status is "Done" AND PR is merged.
 * Default is false - not done until explicitly both conditions are met.
 */
export function isAlreadyDone({ context }: GuardContext): boolean {
  if (
    context.issue.projectStatus === "Done" &&
    context.pr?.state === "MERGED"
  ) {
    return true;
  }
  return false;
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
 * Check if the current issue IS a sub-issue (has a parent)
 * Only sub-issues can be iterated on directly - parent issues must go through orchestration
 */
export function isSubIssue({ context }: GuardContext): boolean {
  return context.parentIssue !== null;
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
 *
 * Returns true only if:
 * - Issue has been groomed (has "groomed" label)
 * - AND either:
 *   - Multi-phase: all sub-issues are Done/CLOSED
 *   - Single-phase: issue had sub-issues that are all complete (not just "no sub-issues exist")
 *
 * Returns false if issue has no sub-issues - this prevents auto-closing
 * issues that haven't been through the full lifecycle or are being re-groomed.
 */
export function allPhasesDone({ context }: GuardContext): boolean {
  // Can't be "all done" if never groomed
  const hasGroomedLabel = context.issue.labels.some(
    (l) => l.toLowerCase() === "groomed",
  );
  if (!hasGroomedLabel) {
    return false;
  }

  // If no sub-issues exist, this is not "phases complete" - it's either:
  // - A simple issue that should iterate directly (not go through orchestration)
  // - An issue being re-groomed after sub-issues were removed
  // Either way, don't auto-close.
  if (context.issue.subIssues.length === 0) {
    return false;
  }

  // Multi-phase: check all sub-issues are complete
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
export function needsParentInit({ context }: GuardContext): boolean {
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
export function currentPhaseComplete({ context }: GuardContext): boolean {
  if (!context.currentSubIssue) {
    return false;
  }
  // Phase is complete when todos are done (extract from MDAST)
  const todos = extractTodosFromAst(context.currentSubIssue.bodyAst);
  return todos.uncheckedNonManual === 0;
}

/**
 * Check if there is a next phase after the current one
 */
export function hasNextPhase({ context }: GuardContext): boolean {
  if (!context.issue.hasSubIssues || context.currentPhase === null) {
    return false;
  }
  return context.currentPhase < context.totalPhases;
}

/**
 * Check if current sub-issue needs assignment (nopo-bot not assigned)
 */
export function subIssueNeedsAssignment({ context }: GuardContext): boolean {
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
    const todos = extractTodosFromAst(context.currentSubIssue.bodyAst);
    return todos.uncheckedNonManual === 0;
  }
  // When triggered directly on a sub-issue (e.g., CI completion),
  // currentSubIssue is null but the issue itself has todos
  const todos = extractTodosFromAst(context.issue.bodyAst);
  return todos.uncheckedNonManual === 0;
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
  return context.trigger === "issue-assigned";
}

/**
 * Check if triggered by issue edit
 */
export function triggeredByEdit({ context }: GuardContext): boolean {
  return context.trigger === "issue-edited";
}

/**
 * Check if triggered by CI completion
 */
export function triggeredByCI({ context }: GuardContext): boolean {
  return context.trigger === "workflow-run-completed";
}

/**
 * Check if triggered by review submission
 */
export function triggeredByReview({ context }: GuardContext): boolean {
  return context.trigger === "pr-review-submitted";
}

/**
 * Check if triggered by review request
 */
export function triggeredByReviewRequest({ context }: GuardContext): boolean {
  return context.trigger === "pr-review-requested";
}

/**
 * Check if triggered by triage request
 */
export function triggeredByTriage({ context }: GuardContext): boolean {
  return context.trigger === "issue-triage";
}

/**
 * Check if triggered by issue comment (@claude mention)
 */
export function triggeredByComment({ context }: GuardContext): boolean {
  return context.trigger === "issue-comment";
}

/**
 * Check if triggered by orchestration request
 */
export function triggeredByOrchestrate({ context }: GuardContext): boolean {
  return context.trigger === "issue-orchestrate";
}

/**
 * Check if triggered by PR review request (bot should review the PR)
 * Matches both:
 * - pr-review-requested: when someone requests review from nopo-reviewer
 * - pr-review: legacy trigger for review submission events
 */
export function triggeredByPRReview({ context }: GuardContext): boolean {
  return (
    context.trigger === "pr-review-requested" || context.trigger === "pr-review"
  );
}

/**
 * Check if triggered by PR response (bot should respond to bot's review)
 */
export function triggeredByPRResponse({ context }: GuardContext): boolean {
  return context.trigger === "pr-response";
}

/**
 * Check if triggered by PR human response (bot should respond to human's review)
 */
export function triggeredByPRHumanResponse({ context }: GuardContext): boolean {
  return context.trigger === "pr-human-response";
}

/**
 * Check if triggered by PR review approved (Claude approved the PR via nopo-reviewer)
 * This triggers orchestration to merge the PR
 */
export function triggeredByPRReviewApproved({
  context,
}: GuardContext): boolean {
  return context.trigger === "pr-review-approved";
}

/**
 * Check if triggered by a push to a PR branch (pr-push)
 * This converts the PR to draft and removes the reviewer
 */
export function triggeredByPRPush({ context }: GuardContext): boolean {
  return context.trigger === "pr-push";
}

/**
 * Check if triggered by /reset command
 * Resets issue to Backlog/Ready state for re-running
 */
export function triggeredByReset({ context }: GuardContext): boolean {
  return context.trigger === "issue-reset";
}

/**
 * Check if triggered by /pivot command
 * Allows modifying issue specifications mid-flight
 */
export function triggeredByPivot({ context }: GuardContext): boolean {
  return context.trigger === "issue-pivot";
}

// ============================================================================
// Merge Queue Logging Guards
// ============================================================================

/**
 * Check if triggered by merge queue entry
 */
export function triggeredByMergeQueueEntry({ context }: GuardContext): boolean {
  return context.trigger === "merge-queue-entered";
}

/**
 * Check if triggered by merge queue failure
 */
export function triggeredByMergeQueueFailure({
  context,
}: GuardContext): boolean {
  return context.trigger === "merge-queue-failed";
}

/**
 * Check if triggered by PR merged event
 */
export function triggeredByPRMerged({ context }: GuardContext): boolean {
  return context.trigger === "pr-merged";
}

/**
 * Check if triggered by stage deployment
 */
export function triggeredByDeployedStage({ context }: GuardContext): boolean {
  return context.trigger === "deployed-stage";
}

/**
 * Check if triggered by production deployment
 */
export function triggeredByDeployedProd({ context }: GuardContext): boolean {
  return context.trigger === "deployed-prod";
}

/**
 * Check if triggered by stage deployment failure
 */
function triggeredByDeployedStageFailure({ context }: GuardContext): boolean {
  return context.trigger === "deployed-stage-failed";
}

/**
 * Check if triggered by production deployment failure
 */
function triggeredByDeployedProdFailure({ context }: GuardContext): boolean {
  return context.trigger === "deployed-prod-failed";
}

// ============================================================================
// Triage Guards
// ============================================================================

/**
 * Check if the issue needs triage (doesn't have "triaged" label)
 */
export function needsTriage({ context }: GuardContext): boolean {
  return !context.issue.labels.includes("triaged");
}

/**
 * Check if the issue has been triaged (has "triaged" label)
 */
export function isTriaged({ context }: GuardContext): boolean {
  return context.issue.labels.includes("triaged");
}

// ============================================================================
// Grooming Guards
// ============================================================================

/**
 * Check if triggered by grooming request
 */
export function triggeredByGroom({ context }: GuardContext): boolean {
  return context.trigger === "issue-groom";
}

/**
 * Check if triggered by grooming summary request
 */
export function triggeredByGroomSummary({ context }: GuardContext): boolean {
  return context.trigger === "issue-groom-summary";
}

/**
 * Check if the issue needs grooming
 * True when: has "triaged" label, but NOT "groomed"
 * Note: "needs-info" does NOT block grooming - it just means questions were asked.
 * When user answers questions and triggers /lfg, grooming re-runs to evaluate.
 */
export function needsGrooming({ context }: GuardContext): boolean {
  const labels = context.issue.labels;
  const hasTriaged = labels.includes("triaged");
  const hasGroomed = labels.includes("groomed");

  return hasTriaged && !hasGroomed;
}

/**
 * Check if the issue has been groomed (has "groomed" label)
 */
export function isGroomed({ context }: GuardContext): boolean {
  return context.issue.labels.includes("groomed");
}

/**
 * Check if all questions in the issue body's Questions section are answered (checked)
 */
function allQuestionsAnswered({ context }: GuardContext): boolean {
  const stats = extractQuestionsFromAst(context.issue.bodyAst);
  return stats.unanswered === 0;
}

/**
 * Check if the issue needs more info (has "needs-info" label)
 */
export function needsInfo({ context }: GuardContext): boolean {
  return context.issue.labels.includes("needs-info");
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
  isSubIssue,
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
  triggeredByPRReviewApproved,
  triggeredByPRPush,
  triggeredByReset,
  triggeredByPivot,
  // Merge queue logging guards
  triggeredByMergeQueueEntry,
  triggeredByMergeQueueFailure,
  triggeredByPRMerged,
  triggeredByDeployedStage,
  triggeredByDeployedProd,
  triggeredByDeployedStageFailure,
  triggeredByDeployedProdFailure,
  // Triage guards
  needsTriage,
  isTriaged,
  // Grooming guards
  triggeredByGroom,
  triggeredByGroomSummary,
  needsGrooming,
  isGroomed,
  allQuestionsAnswered,
  needsInfo,
  // Composite guards
  readyForReview,
  shouldContinueIterating,
  shouldBlock,
};
