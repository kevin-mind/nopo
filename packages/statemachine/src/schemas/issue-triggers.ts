import { z } from "zod";

/**
 * Issue/PR trigger types
 *
 * These triggers are specific to the issue automation state machine,
 * handling issues, PRs, workflow runs, and release events.
 */
export const IssueTriggerTypeSchema = z.enum([
  // Issue triggers
  "issue-assigned",
  "issue-edited",
  "issue-closed",
  "issue-triage",
  "issue-groom",
  "issue-orchestrate",
  "issue-comment",
  "issue-pivot",
  "issue-reset",
  "issue-retry",
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
  "deployed-stage-failed",
  "deployed-prod-failed",
]);

export type IssueTriggerType = z.infer<typeof IssueTriggerTypeSchema>;

/**
 * All issue trigger types as a const array for runtime use
 */
export const ISSUE_TRIGGER_TYPES = IssueTriggerTypeSchema.options;
