import { z } from "zod";
import { BaseMachineContextSchema } from "./base.js";
import { IssueTriggerTypeSchema } from "./issue-triggers.js";
import {
  ParentIssueSchema,
  SubIssueSchema,
  LinkedPRSchema,
  CIResultSchema,
  ReviewDecisionSchema,
} from "./entities.js";

/**
 * Issue machine context schema
 *
 * Contains all fields needed for the issue automation state machine,
 * which handles issues, PRs, CI, and release events.
 */
const IssueContextSchema = BaseMachineContextSchema.extend({
  // Trigger info
  trigger: IssueTriggerTypeSchema,

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
});

type IssueContext = z.infer<typeof IssueContextSchema>;

/**
 * Default values for optional issue context fields
 */
const ISSUE_CONTEXT_DEFAULTS: Partial<IssueContext> = {
  parentIssue: null,
  currentPhase: null,
  totalPhases: 0,
  currentSubIssue: null,
  ciResult: null,
  ciRunUrl: null,
  ciCommitSha: null,
  workflowStartedAt: null,
  reviewDecision: null,
  reviewerId: null,
  branch: null,
  hasBranch: false,
  pr: null,
  hasPR: false,
  commentContextType: null,
  commentContextDescription: null,
  releaseEvent: null,
  maxRetries: 5,
  botUsername: "nopo-bot",
};

/**
 * Partial context for creating from parsed data
 * Required: trigger, owner, repo, issue
 * All other fields are optional and will use defaults
 */
type PartialIssueContext = Pick<
  IssueContext,
  "trigger" | "owner" | "repo" | "issue"
> &
  Partial<Omit<IssueContext, "trigger" | "owner" | "repo" | "issue">>;

/**
 * Helper to create a full issue context from partial data
 */
function createIssueContext(partial: PartialIssueContext): IssueContext {
  return IssueContextSchema.parse({
    ...ISSUE_CONTEXT_DEFAULTS,
    ...partial,
  });
}
