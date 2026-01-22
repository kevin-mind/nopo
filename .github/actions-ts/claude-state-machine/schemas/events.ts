import type { TriggerType, ReviewDecision, CIResult } from "./state.js";

/**
 * Base event properties shared by all GitHub events
 */
interface BaseEvent {
  owner: string;
  repo: string;
  timestamp?: string;
}

// ============================================================================
// Issue Events
// ============================================================================

/**
 * Issue assigned event
 */
interface IssueAssignedEvent extends BaseEvent {
  type: "issue_assigned";
  issueNumber: number;
  assignee: string;
}

/**
 * Issue edited event
 */
interface IssueEditedEvent extends BaseEvent {
  type: "issue_edited";
  issueNumber: number;
  changedField?: "body" | "title" | "labels" | "assignees";
}

/**
 * Issue closed event
 */
interface IssueClosedEvent extends BaseEvent {
  type: "issue_closed";
  issueNumber: number;
  stateReason?: "completed" | "not_planned";
}

/**
 * Issue comment event
 */
interface IssueCommentEvent extends BaseEvent {
  type: "issue_comment";
  issueNumber: number;
  commentId: number;
  commentBody: string;
  author: string;
  isPR?: boolean;
}

// ============================================================================
// PR Events
// ============================================================================

/**
 * PR review requested event
 */
interface PRReviewRequestedEvent extends BaseEvent {
  type: "pr_review_requested";
  prNumber: number;
  issueNumber?: number;
  requestedReviewer: string;
  headRef: string;
  baseRef?: string;
  isDraft: boolean;
}

/**
 * PR review submitted event
 */
interface PRReviewSubmittedEvent extends BaseEvent {
  type: "pr_review_submitted";
  prNumber: number;
  issueNumber?: number;
  reviewId: number;
  reviewer: string;
  decision: ReviewDecision;
  body?: string;
  headRef: string;
  baseRef?: string;
}

/**
 * PR push event (push to a branch with an open PR)
 */
interface PRPushEvent extends BaseEvent {
  type: "pr_push";
  prNumber: number;
  issueNumber?: number;
  headRef: string;
  commitSha: string;
  wasDraft: boolean;
  isNowDraft: boolean;
}

// ============================================================================
// Workflow Events
// ============================================================================

/**
 * Workflow run completed event
 */
interface WorkflowRunCompletedEvent extends BaseEvent {
  type: "workflow_run_completed";
  workflowName: string;
  runId: number;
  runUrl: string;
  headRef: string;
  headSha: string;
  result: CIResult;
  issueNumber?: number;
  prNumber?: number;
}

// ============================================================================
// Merge Queue Logging Events
// ============================================================================

/**
 * Merge queue entry event - PR added to merge queue
 */
interface MergeQueueEnteredEvent extends BaseEvent {
  type: "merge_queue_entered";
  prNumber: number;
  issueNumber: number;
  parentIssueNumber?: number;
  headRef: string;
}

/**
 * Merge queue failure event - PR removed from queue due to failure
 */
interface MergeQueueFailedEvent extends BaseEvent {
  type: "merge_queue_failed";
  prNumber: number;
  issueNumber: number;
  parentIssueNumber?: number;
  failureReason: string;
}

/**
 * PR merged event - PR merged to main
 */
interface PRMergedEvent extends BaseEvent {
  type: "pr_merged";
  prNumber: number;
  issueNumber: number;
  parentIssueNumber?: number;
  commitSha: string;
}

/**
 * Stage deployment event - deployed to staging
 */
interface DeployedStageEvent extends BaseEvent {
  type: "deployed_stage";
  issueNumber: number;
  parentIssueNumber?: number;
  commitSha: string;
}

/**
 * Production deployment event - released to production
 */
interface DeployedProdEvent extends BaseEvent {
  type: "deployed_prod";
  issueNumber: number;
  parentIssueNumber?: number;
  commitSha: string;
}

// ============================================================================
// Union Type of All Events
// ============================================================================

/**
 * All possible event types as a discriminated union
 */
export type GitHubEvent =
  | IssueAssignedEvent
  | IssueEditedEvent
  | IssueClosedEvent
  | IssueCommentEvent
  | PRReviewRequestedEvent
  | PRReviewSubmittedEvent
  | PRPushEvent
  | WorkflowRunCompletedEvent
  | MergeQueueEnteredEvent
  | MergeQueueFailedEvent
  | PRMergedEvent
  | DeployedStageEvent
  | DeployedProdEvent;

/**
 * Map event type to trigger type
 */
export function eventToTrigger(event: GitHubEvent): TriggerType {
  return event.type as TriggerType;
}
