/**
 * Concurrency group patterns for Claude automation workflows.
 * These prevent race conditions between different workflow triggers.
 */

export interface ConcurrencyConfig {
  group: string
  'cancel-in-progress': boolean
}

/**
 * Concurrency group for issue-related jobs - keyed by issue number and action.
 * Uses cancel-in-progress: false to queue jobs without canceling.
 */
export const claudeIssueConcurrency = (issueNumber: string, action: string): ConcurrencyConfig => ({
  group: `claude-issue-${issueNumber}-${action}`,
  'cancel-in-progress': false,
})

/**
 * Concurrency group for triage - allows cancellation of in-progress triages
 * when the issue is edited (newer context should take precedence).
 */
export const claudeTriageConcurrency = (issueNumber: string): ConcurrencyConfig => ({
  group: `claude-triage-${issueNumber}`,
  'cancel-in-progress': true,
})

/**
 * Concurrency group for review-related jobs - CRITICAL!
 *
 * This group is shared between ci-loop and review-loop workflows:
 * - Push jobs (ci-loop): Use cancel-in-progress: true to cancel reviews when new code is pushed
 * - Review jobs (review-loop): Use cancel-in-progress: false to queue without canceling
 *
 * This ensures that:
 * 1. A push always cancels in-flight reviews (code has changed, review is stale)
 * 2. Reviews queue up if multiple are triggered (e.g., re-requesting review)
 */
export const claudeReviewConcurrency = (
  branchName: string,
  cancelInProgress: boolean
): ConcurrencyConfig => ({
  group: `claude-review-${branchName}`,
  'cancel-in-progress': cancelInProgress,
})

/**
 * Concurrency group for discussion automation - queues without canceling.
 */
export const claudeDiscussionConcurrency = (discussionNumber: string): ConcurrencyConfig => ({
  group: `claude-discussion-${discussionNumber}`,
  'cancel-in-progress': false,
})

/**
 * Expression for issue-based concurrency group used in workflow-level concurrency.
 * Handles issue_comment, pull_request_review_comment, and workflow_dispatch triggers.
 */
export const ISSUE_CONCURRENCY_EXPRESSION =
  'claude-issue-${{ github.event.issue.number || github.event.pull_request.number || github.event.inputs.issue_number }}-${{ github.event.action || github.event.inputs.action }}'

/**
 * Expression for review-based concurrency group.
 * Uses PR head branch name for grouping.
 */
export const REVIEW_CONCURRENCY_EXPRESSION =
  "claude-review-${{ github.event.pull_request.head.ref || github.event.workflow_run.head_branch || github.event.inputs.pr_branch || 'unknown' }}"
