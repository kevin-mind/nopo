import { expressions } from "@github-actions-workflow-ts/lib";

/**
 * Concurrency group patterns for Claude automation workflows.
 * These prevent race conditions between different workflow triggers.
 */

/**
 * Expression for issue-based concurrency group used in workflow-level concurrency.
 * Handles issue_comment, pull_request_review_comment, and workflow_dispatch triggers.
 */
export const ISSUE_CONCURRENCY_EXPRESSION =
  `claude-issue-${expressions.expn("github.event.issue.number || github.event.pull_request.number || github.event.inputs.issue_number")}-${expressions.expn("github.event.action || github.event.inputs.action")}`;
