import { z } from "zod";

/**
 * Issue/PR trigger types
 *
 * These triggers are specific to the issue automation state machine,
 * handling issues, PRs, workflow runs, and release events.
 */
export const IssueTriggerTypeSchema = z.enum([
  // Issue triggers
  "issue_assigned",
  "issue_edited",
  "issue_closed",
  "issue_triage",
  "issue_orchestrate",
  "issue_comment",
  // PR triggers
  "pr_review_requested",
  "pr_review_submitted",
  "pr_review",
  "pr_review_approved",
  "pr_response",
  "pr_human_response",
  "pr_push",
  // Workflow triggers
  "workflow_run_completed",
  // Release triggers (legacy - kept for backwards compatibility)
  "release_queue_entry",
  "release_merged",
  "release_deployed",
  "release_queue_failure",
  // Merge queue logging triggers
  "merge_queue_entered",
  "merge_queue_failed",
  "pr_merged",
  "deployed_stage",
  "deployed_prod",
]);

export type IssueTriggerType = z.infer<typeof IssueTriggerTypeSchema>;

/**
 * All issue trigger types as a const array for runtime use
 */
export const ISSUE_TRIGGER_TYPES = IssueTriggerTypeSchema.options;
