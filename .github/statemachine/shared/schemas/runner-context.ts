import { z } from "zod";

/**
 * Runner Context Schema
 *
 * Single source of truth for the interface between detect-event and sm-runner.
 * This schema defines all fields passed via context_json.
 */

// ============================================================================
// Trigger Types
// ============================================================================

export const IssueTriggerTypeSchema = z.enum([
  // Issue triggers
  "issue-assigned",
  "issue-edited",
  "issue-closed",
  "issue-triage",
  "issue-orchestrate",
  "issue-comment",
  "issue-reset",
  // PR triggers
  "pr-review-requested",
  "pr-review-submitted",
  "pr-review",
  "pr-review-approved",
  "pr-response",
  "pr-human-response",
  "pr-push",
  // Workflow triggers
  "workflow-run-completed",
  // Merge queue logging triggers
  "merge-queue-entered",
  "merge-queue-failed",
  "pr-merged",
  "deployed-stage",
  "deployed-prod",
]);

export const DiscussionTriggerTypeSchema = z.enum([
  "discussion-created",
  "discussion-comment",
  "discussion-command",
]);

export const TriggerTypeSchema = z.union([
  IssueTriggerTypeSchema,
  DiscussionTriggerTypeSchema,
]);

export type IssueTriggerType = z.infer<typeof IssueTriggerTypeSchema>;
export type DiscussionTriggerType = z.infer<typeof DiscussionTriggerTypeSchema>;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

// ============================================================================
// Job Types
// ============================================================================

export const JobTypeSchema = z.enum([
  // Issue jobs
  "issue-triage",
  "issue-iterate",
  "issue-orchestrate",
  "issue-comment",
  "issue-reset",
  // PR jobs
  "pr-push",
  "pr-review-requested", // When someone requests a review from the bot
  "pr-review", // Legacy: when bot should review (has review decision)
  "pr-review-approved",
  "pr-response",
  "pr-human-response",
  // Merge queue
  "merge-queue-logging",
  // Discussion jobs
  "discussion-research",
  "discussion-respond",
  "discussion-summarize",
  "discussion-plan",
  "discussion-complete",
  // Empty (skip)
  "",
]);

export type JobType = z.infer<typeof JobTypeSchema>;

// ============================================================================
// Resource Types
// ============================================================================

export const ResourceTypeSchema = z.enum(["issue", "pr", "discussion", ""]);

export type ResourceType = z.infer<typeof ResourceTypeSchema>;

// ============================================================================
// Other Enums
// ============================================================================

export const CIResultSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
]);

export type CIResult = z.infer<typeof CIResultSchema>;

export const ReviewDecisionSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
]);

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const DiscussionCommandSchema = z.enum([
  "summarize",
  "plan",
  "complete",
]);

export type DiscussionCommand = z.infer<typeof DiscussionCommandSchema>;

export const ContextTypeSchema = z.enum(["issue", "pr"]);

export type ContextType = z.infer<typeof ContextTypeSchema>;

// ============================================================================
// Runner Context Schema
// ============================================================================

/**
 * Context passed from detect-event to sm-runner
 *
 * This is the single output from detect-event and the single input to sm-runner.
 * All routing, resource identification, and trigger-specific fields are included.
 */
export const RunnerContextSchema = z.object({
  // ========================================
  // Routing & Control (previously separate outputs)
  // ========================================

  /** Job type to run (e.g., "issue-iterate", "pr-review", "discussion-research") */
  job: JobTypeSchema,

  /** Trigger type for the state machine */
  trigger: TriggerTypeSchema,

  /** Type of resource being processed */
  resource_type: ResourceTypeSchema,

  /** Resource number (issue, PR, or discussion number) */
  resource_number: z.string(),

  /** Parent issue number for sub-issues (or "0" if not a sub-issue) */
  parent_issue: z.string().default("0"),

  /** Comment ID that triggered this run (for reactions) */
  comment_id: z.string().default(""),

  /** Concurrency group name */
  concurrency_group: z.string(),

  /** Whether to cancel in-progress runs in the same group */
  cancel_in_progress: z.boolean().default(false),

  /** Whether to skip processing */
  skip: z.boolean().default(false),

  /** Reason for skipping (if skip is true) */
  skip_reason: z.string().default(""),

  // ========================================
  // Issue-specific fields
  // ========================================

  /** Issue number */
  issue_number: z.string().optional(),

  /** Issue title */
  issue_title: z.string().optional(),

  /** Issue body */
  issue_body: z.string().optional(),

  /** Branch name for the work */
  branch_name: z.string().optional(),

  /** Whether the branch already exists */
  existing_branch: z.string().optional(),

  /** Phase number for sub-issues */
  phase_number: z.string().optional(),

  /** Comma-separated list of sub-issue numbers */
  sub_issues: z.string().optional(),

  /** Project status from GitHub Project field */
  project_status: z.string().optional(),

  /** Project iteration from GitHub Project field */
  project_iteration: z.string().optional(),

  /** Project failures from GitHub Project field */
  project_failures: z.string().optional(),

  /** Closed sub-issue number (for sub_issue_closed trigger) */
  closed_sub_issue: z.string().optional(),

  // ========================================
  // CI-specific fields (workflow_run_completed)
  // ========================================

  /** CI result (success, failure, cancelled, skipped) */
  ci_result: CIResultSchema.optional(),

  /** CI run URL */
  ci_run_url: z.string().optional(),

  /** CI commit SHA */
  ci_commit_sha: z.string().optional(),

  // ========================================
  // Review-specific fields (pr_review_submitted)
  // ========================================

  /** Review decision */
  review_decision: ReviewDecisionSchema.optional(),

  /** Review state (lowercase version: approved, changes_requested, commented) */
  review_state: z.string().optional(),

  /** Review body */
  review_body: z.string().optional(),

  /** Review ID */
  review_id: z.string().optional(),

  /** Reviewer username */
  reviewer: z.string().optional(),

  /** Reviewer login (alias for reviewer) */
  reviewer_login: z.string().optional(),

  // ========================================
  // PR-specific fields
  // ========================================

  /** PR number */
  pr_number: z.string().optional(),

  /** Whether PR is a draft */
  is_draft: z.boolean().optional(),

  /** Issue section content (for pr-review job) */
  issue_section: z.string().optional(),

  /** Merge queue head ref */
  head_ref: z.string().optional(),

  /** Merge queue head SHA */
  head_sha: z.string().optional(),

  // ========================================
  // Comment-specific fields (issue_comment)
  // ========================================

  /** Context type for comment (Issue or PR) */
  context_type: ContextTypeSchema.optional(),

  /** Context description for comment */
  context_description: z.string().optional(),

  // ========================================
  // Discussion-specific fields
  // ========================================

  /** Discussion number */
  discussion_number: z.string().optional(),

  /** Discussion title */
  discussion_title: z.string().optional(),

  /** Discussion body */
  discussion_body: z.string().optional(),

  /** Comment body (for discussion comments) */
  comment_body: z.string().optional(),

  /** Comment author username */
  comment_author: z.string().optional(),

  /** Discussion command (/summarize, /plan, /complete) */
  command: DiscussionCommandSchema.optional(),

  /** Whether this is a test automation run */
  is_test_automation: z.boolean().optional(),

  // ========================================
  // Internal trigger type tracking
  // ========================================

  /**
   * Internal trigger type (may differ from the job name)
   * Used when the state machine needs a different trigger than the job implies
   */
  trigger_type: z.string().optional(),
});

export type RunnerContext = z.infer<typeof RunnerContextSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse and validate runner context from JSON string
 */
export function parseRunnerContext(json: string): RunnerContext {
  const parsed = JSON.parse(json);
  return RunnerContextSchema.parse(parsed);
}

/**
 * Check if a trigger is a discussion trigger
 */
export function isDiscussionTrigger(
  trigger: string,
): trigger is DiscussionTriggerType {
  return DiscussionTriggerTypeSchema.safeParse(trigger).success;
}

/**
 * Check if a trigger is an issue trigger
 */
export function isIssueTrigger(trigger: string): trigger is IssueTriggerType {
  return IssueTriggerTypeSchema.safeParse(trigger).success;
}
