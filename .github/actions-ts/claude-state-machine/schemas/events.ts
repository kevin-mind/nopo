import { z } from "zod";
import {
  TriggerTypeSchema,
  ReviewDecisionSchema,
  CIResultSchema,
} from "./state.js";

/**
 * Base event properties shared by all GitHub events
 */
const BaseEventSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  timestamp: z.string().datetime().optional(),
});

// ============================================================================
// Issue Events
// ============================================================================

/**
 * Issue assigned event
 */
const IssueAssignedEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_assigned"),
  issueNumber: z.number().int().positive(),
  assignee: z.string().min(1),
});

type IssueAssignedEvent = z.infer<typeof IssueAssignedEventSchema>;

/**
 * Issue edited event
 */
const IssueEditedEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_edited"),
  issueNumber: z.number().int().positive(),
  changedField: z.enum(["body", "title", "labels", "assignees"]).optional(),
});

type IssueEditedEvent = z.infer<typeof IssueEditedEventSchema>;

/**
 * Issue closed event
 */
const IssueClosedEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_closed"),
  issueNumber: z.number().int().positive(),
  stateReason: z.enum(["completed", "not_planned"]).optional(),
});

type IssueClosedEvent = z.infer<typeof IssueClosedEventSchema>;

/**
 * Issue comment event
 */
const IssueCommentEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_comment"),
  issueNumber: z.number().int().positive(),
  commentId: z.number().int().positive(),
  commentBody: z.string(),
  author: z.string().min(1),
  isPR: z.boolean().default(false),
});

type IssueCommentEvent = z.infer<typeof IssueCommentEventSchema>;

// ============================================================================
// PR Events
// ============================================================================

/**
 * PR review requested event
 */
const PRReviewRequestedEventSchema = BaseEventSchema.extend({
  type: z.literal("pr_review_requested"),
  prNumber: z.number().int().positive(),
  issueNumber: z.number().int().positive().optional(),
  requestedReviewer: z.string().min(1),
  headRef: z.string().min(1),
  baseRef: z.string().default("main"),
  isDraft: z.boolean(),
});

type PRReviewRequestedEvent = z.infer<
  typeof PRReviewRequestedEventSchema
>;

/**
 * PR review submitted event
 */
const PRReviewSubmittedEventSchema = BaseEventSchema.extend({
  type: z.literal("pr_review_submitted"),
  prNumber: z.number().int().positive(),
  issueNumber: z.number().int().positive().optional(),
  reviewId: z.number().int().positive(),
  reviewer: z.string().min(1),
  decision: ReviewDecisionSchema,
  body: z.string().optional(),
  headRef: z.string().min(1),
  baseRef: z.string().default("main"),
});

type PRReviewSubmittedEvent = z.infer<
  typeof PRReviewSubmittedEventSchema
>;

/**
 * PR push event (push to a branch with an open PR)
 */
const PRPushEventSchema = BaseEventSchema.extend({
  type: z.literal("pr_push"),
  prNumber: z.number().int().positive(),
  issueNumber: z.number().int().positive().optional(),
  headRef: z.string().min(1),
  commitSha: z.string().min(1),
  wasDraft: z.boolean(),
  isNowDraft: z.boolean(),
});

type PRPushEvent = z.infer<typeof PRPushEventSchema>;

// ============================================================================
// Workflow Events
// ============================================================================

/**
 * Workflow run completed event
 */
const WorkflowRunCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal("workflow_run_completed"),
  workflowName: z.string().min(1),
  runId: z.number().int().positive(),
  runUrl: z.string().url(),
  headRef: z.string().min(1),
  headSha: z.string().min(1),
  result: CIResultSchema,
  issueNumber: z.number().int().positive().optional(),
  prNumber: z.number().int().positive().optional(),
});

type WorkflowRunCompletedEvent = z.infer<
  typeof WorkflowRunCompletedEventSchema
>;

// ============================================================================
// Discriminated Union of All Events
// ============================================================================

/**
 * All possible event types as a discriminated union
 */
const GitHubEventSchema = z.discriminatedUnion("type", [
  IssueAssignedEventSchema,
  IssueEditedEventSchema,
  IssueClosedEventSchema,
  IssueCommentEventSchema,
  PRReviewRequestedEventSchema,
  PRReviewSubmittedEventSchema,
  PRPushEventSchema,
  WorkflowRunCompletedEventSchema,
]);

export type GitHubEvent = z.infer<typeof GitHubEventSchema>;

/**
 * Extract event type from union
 */
type EventType = GitHubEvent["type"];

/**
 * Map event type to trigger type
 */
export function eventToTrigger(
  event: GitHubEvent,
): z.infer<typeof TriggerTypeSchema> {
  return event.type as z.infer<typeof TriggerTypeSchema>;
}

/**
 * Extract issue number from any event that has one
 */
function getIssueNumber(event: GitHubEvent): number | undefined {
  if ("issueNumber" in event) {
    return event.issueNumber;
  }
  return undefined;
}

/**
 * Extract PR number from any event that has one
 */
function getPRNumber(event: GitHubEvent): number | undefined {
  if ("prNumber" in event) {
    return event.prNumber;
  }
  return undefined;
}

/**
 * Check if event is issue-related
 */
function isIssueEvent(event: GitHubEvent): boolean {
  return event.type.startsWith("issue_");
}

/**
 * Check if event is PR-related
 */
function isPREvent(event: GitHubEvent): boolean {
  return event.type.startsWith("pr_");
}

/**
 * Check if event is workflow-related
 */
function isWorkflowEvent(event: GitHubEvent): boolean {
  return event.type.startsWith("workflow_");
}
