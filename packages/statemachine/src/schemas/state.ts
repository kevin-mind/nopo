import { z } from "zod";
import {
  ParentIssueSchema,
  SubIssueSchema,
  CIResultSchema,
  ReviewDecisionSchema,
  LinkedPRSchema,
} from "./entities.js";

/**
 * GitHub event trigger types that can start the state machine
 */
export const TriggerTypeSchema = z.enum([
  // Issue triggers
  "issue-assigned",
  "issue-edited",
  "issue-closed",
  "issue-triage",
  "issue-orchestrate",
  "issue-comment",
  "issue-reset",
  "issue-pivot",
  // Grooming triggers
  "issue-groom",
  "issue-groom-summary",
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
  // Discussion triggers
  "discussion-created",
  "discussion-comment",
  "discussion-command",
]);

export type TriggerType = z.infer<typeof TriggerTypeSchema>;

/**
 * Full machine context - everything the state machine needs to make decisions
 */
export const MachineContextSchema = z.object({
  // Trigger info
  trigger: TriggerTypeSchema,

  // Repository info
  owner: z.string().min(1),
  repo: z.string().min(1),

  // Issue being worked on (could be parent or sub-issue)
  issue: ParentIssueSchema,

  // If this is a sub-issue, the parent
  parentIssue: ParentIssueSchema.nullable(),

  // Current phase info (derived from sub-issues)
  currentPhase: z.number().int().positive().nullable(),
  totalPhases: z.number().int().min(0),
  currentSubIssue: SubIssueSchema.nullable(),

  // CI result (if triggered by workflow_run)
  ciResult: CIResultSchema.nullable(),
  ciRunUrl: z.string().nullable(),
  ciCommitSha: z.string().nullable(),

  // Workflow timing
  /** ISO 8601 timestamp of when the workflow started */
  workflowStartedAt: z.string().nullable(),
  /** URL to the current workflow run */
  workflowRunUrl: z.string().nullable().default(null),

  // Review result (if triggered by pr_review_submitted)
  reviewDecision: ReviewDecisionSchema.nullable(),
  reviewerId: z.string().nullable(),

  // Branch info
  branch: z.string().nullable(),
  hasBranch: z.boolean(),

  // PR info (for the current phase/issue)
  pr: LinkedPRSchema.nullable(),
  hasPR: z.boolean(),

  // Comment info (if triggered by issue_comment)
  commentContextType: z
    .string()
    .transform((v) => v?.toLowerCase())
    .pipe(z.enum(["issue", "pr"]))
    .nullable()
    .default(null),
  commentContextDescription: z.string().nullable().default(null),

  // Pivot info (if triggered by issue-pivot)
  pivotDescription: z.string().nullable().default(null),

  // Release info (if triggered by release_* events)
  releaseEvent: z
    .object({
      type: z.enum(["queue_entry", "merged", "deployed", "queue_failure"]),
      commitSha: z.string().optional(),
      failureReason: z.string().optional(),
      services: z.array(z.string()).optional(),
    })
    .nullable()
    .default(null),

  // Discussion info (if triggered by discussion_* events)
  discussion: z
    .object({
      number: z.number().int().positive(),
      nodeId: z.string(),
      title: z.string(),
      body: z.string(),
      commentCount: z.number().int().min(0).default(0),
      researchThreads: z
        .array(
          z.object({
            nodeId: z.string(),
            topic: z.string(),
            replyCount: z.number().int().min(0),
          }),
        )
        .default([]),
      command: z.enum(["summarize", "plan", "complete"]).optional(),
      commentId: z.string().optional(),
      commentBody: z.string().optional(),
      commentAuthor: z.string().optional(),
    })
    .nullable()
    .default(null),

  // Config
  maxRetries: z.number().int().positive().default(5),
  botUsername: z.string().default("nopo-bot"),
});

export type MachineContext = z.infer<typeof MachineContextSchema>;

/**
 * Partial context for creating from parsed data
 * Required: trigger, owner, repo, issue
 * All other fields are optional and will use defaults
 */
type PartialMachineContext = Pick<
  MachineContext,
  "trigger" | "owner" | "repo" | "issue"
> &
  Partial<Omit<MachineContext, "trigger" | "owner" | "repo" | "issue">>;

/**
 * Default values for optional context fields
 */
const DEFAULT_CONTEXT_VALUES: Partial<MachineContext> = {
  parentIssue: null,
  currentPhase: null,
  totalPhases: 0,
  currentSubIssue: null,
  ciResult: null,
  ciRunUrl: null,
  ciCommitSha: null,
  workflowStartedAt: null,
  workflowRunUrl: null,
  reviewDecision: null,
  reviewerId: null,
  branch: null,
  hasBranch: false,
  pr: null,
  hasPR: false,
  commentContextType: null,
  commentContextDescription: null,
  pivotDescription: null,
  releaseEvent: null,
  discussion: null,
  maxRetries: 5,
  botUsername: "nopo-bot",
};

/**
 * Helper to create a full context from partial data
 */
export function createMachineContext(
  partial: PartialMachineContext,
): MachineContext {
  return MachineContextSchema.parse({
    ...DEFAULT_CONTEXT_VALUES,
    ...partial,
  });
}
