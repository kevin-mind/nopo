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
export const IssueAssignedEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_assigned"),
  issueNumber: z.number().int().positive(),
  assignee: z.string().min(1),
});

export type IssueAssignedEvent = z.infer<typeof IssueAssignedEventSchema>;

/**
 * Issue edited event
 */
export const IssueEditedEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_edited"),
  issueNumber: z.number().int().positive(),
  changedField: z.enum(["body", "title", "labels", "assignees"]).optional(),
});

export type IssueEditedEvent = z.infer<typeof IssueEditedEventSchema>;

/**
 * Issue closed event
 */
export const IssueClosedEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_closed"),
  issueNumber: z.number().int().positive(),
  stateReason: z.enum(["completed", "not_planned"]).optional(),
});

export type IssueClosedEvent = z.infer<typeof IssueClosedEventSchema>;

/**
 * Issue comment event
 */
export const IssueCommentEventSchema = BaseEventSchema.extend({
  type: z.literal("issue_comment"),
  issueNumber: z.number().int().positive(),
  commentId: z.number().int().positive(),
  commentBody: z.string(),
  author: z.string().min(1),
  isPR: z.boolean().default(false),
});

export type IssueCommentEvent = z.infer<typeof IssueCommentEventSchema>;

// ============================================================================
// PR Events
// ============================================================================

/**
 * PR review requested event
 */
export const PRReviewRequestedEventSchema = BaseEventSchema.extend({
  type: z.literal("pr_review_requested"),
  prNumber: z.number().int().positive(),
  issueNumber: z.number().int().positive().optional(),
  requestedReviewer: z.string().min(1),
  headRef: z.string().min(1),
  baseRef: z.string().default("main"),
  isDraft: z.boolean(),
});

export type PRReviewRequestedEvent = z.infer<
  typeof PRReviewRequestedEventSchema
>;

/**
 * PR review submitted event
 */
export const PRReviewSubmittedEventSchema = BaseEventSchema.extend({
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

export type PRReviewSubmittedEvent = z.infer<
  typeof PRReviewSubmittedEventSchema
>;

/**
 * PR push event (push to a branch with an open PR)
 */
export const PRPushEventSchema = BaseEventSchema.extend({
  type: z.literal("pr_push"),
  prNumber: z.number().int().positive(),
  issueNumber: z.number().int().positive().optional(),
  headRef: z.string().min(1),
  commitSha: z.string().min(1),
  wasDraft: z.boolean(),
  isNowDraft: z.boolean(),
});

export type PRPushEvent = z.infer<typeof PRPushEventSchema>;

// ============================================================================
// Workflow Events
// ============================================================================

/**
 * Workflow run completed event
 */
export const WorkflowRunCompletedEventSchema = BaseEventSchema.extend({
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

export type WorkflowRunCompletedEvent = z.infer<
  typeof WorkflowRunCompletedEventSchema
>;

// ============================================================================
// Discriminated Union of All Events
// ============================================================================

/**
 * All possible event types as a discriminated union
 */
export const GitHubEventSchema = z.discriminatedUnion("type", [
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
export type EventType = GitHubEvent["type"];

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
export function getIssueNumber(event: GitHubEvent): number | undefined {
  if ("issueNumber" in event) {
    return event.issueNumber;
  }
  return undefined;
}

/**
 * Extract PR number from any event that has one
 */
export function getPRNumber(event: GitHubEvent): number | undefined {
  if ("prNumber" in event) {
    return event.prNumber;
  }
  return undefined;
}

/**
 * Check if event is issue-related
 */
export function isIssueEvent(event: GitHubEvent): boolean {
  return event.type.startsWith("issue_");
}

/**
 * Check if event is PR-related
 */
export function isPREvent(event: GitHubEvent): boolean {
  return event.type.startsWith("pr_");
}

/**
 * Check if event is workflow-related
 */
export function isWorkflowEvent(event: GitHubEvent): boolean {
  return event.type.startsWith("workflow_");
}
