import { z } from "zod";

/**
 * Project field values for Status single-select field
 *
 * NOTE: These must match the exact option names in the GitHub Project.
 * GitHub project has: Backlog, In progress, Ready, In review, Done, Blocked, Error
 * (note lowercase "progress" and "In review" not "Review")
 *
 * Parent issues use: Backlog, In progress, Done, Blocked, Error
 * Sub-issues use: Ready, In progress, In review, Done
 */
export const ProjectStatusSchema = z.enum([
  "Backlog",
  "In progress",
  "Ready",
  "In review",
  "Done",
  "Blocked",
  "Error",
]);

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/**
 * GitHub issue state (OPEN or CLOSED)
 */
export const IssueStateSchema = z.enum(["OPEN", "CLOSED"]);

export type IssueState = z.infer<typeof IssueStateSchema>;

/**
 * Pull request state
 */
export const PRStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"]);

export type PRState = z.infer<typeof PRStateSchema>;

/**
 * Todo item parsed from issue body
 */
export const TodoItemSchema = z.object({
  text: z.string(),
  checked: z.boolean(),
  isManual: z.boolean(),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;

/**
 * Aggregated todo statistics
 */
export const TodoStatsSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  uncheckedNonManual: z.number().int().min(0),
});

export type TodoStats = z.infer<typeof TodoStatsSchema>;

/**
 * Iteration history entry from the history table
 */
export const HistoryEntrySchema = z.object({
  iteration: z.number().int().min(0),
  phase: z.string(),
  action: z.string(),
  timestamp: z.string().nullable(),
  sha: z.string().nullable(),
  runLink: z.string().nullable(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/**
 * Agent notes entry from a workflow run
 */
const AgentNotesEntrySchema = z.object({
  runId: z.string(),
  runLink: z.string(),
  timestamp: z.string(),
  notes: z.array(z.string()),
});

type AgentNotesEntry = z.infer<typeof AgentNotesEntrySchema>;

/**
 * Issue comment from GitHub
 */
export const IssueCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  isBot: z.boolean(),
});

export type IssueComment = z.infer<typeof IssueCommentSchema>;

/**
 * Status check rollup state from GitHub GraphQL API
 */
export const CIStatusSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "PENDING",
  "ERROR",
  "EXPECTED",
]);

export type CIStatus = z.infer<typeof CIStatusSchema>;

/**
 * Pull request associated with a sub-issue
 */
export const LinkedPRSchema = z.object({
  number: z.number().int().positive(),
  state: PRStateSchema,
  isDraft: z.boolean(),
  title: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  // CI status from statusCheckRollup
  ciStatus: CIStatusSchema.nullable().optional(),
});

export type LinkedPR = z.infer<typeof LinkedPRSchema>;

/**
 * Sub-issue state representing a single phase of work
 */
export const SubIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: IssueStateSchema,
  body: z.string(),
  projectStatus: ProjectStatusSchema.nullable(),
  branch: z.string().nullable(),
  pr: LinkedPRSchema.nullable(),
  todos: TodoStatsSchema,
});

export type SubIssue = z.infer<typeof SubIssueSchema>;

/**
 * Parent issue state - the main issue being worked on
 * Note: This is also used for sub-issues when they are the trigger target
 */
export const ParentIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: IssueStateSchema,
  body: z.string(),
  projectStatus: ProjectStatusSchema.nullable(),
  iteration: z.number().int().min(0),
  failures: z.number().int().min(0),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  subIssues: z.array(SubIssueSchema),
  hasSubIssues: z.boolean(),
  history: z.array(HistoryEntrySchema),
  /** Todos parsed from the issue body - used when this is a sub-issue triggered directly */
  todos: TodoStatsSchema,
  /** Agent notes from previous workflow runs */
  agentNotes: z.array(AgentNotesEntrySchema).default([]),
  /** Issue comments from GitHub */
  comments: z.array(IssueCommentSchema).default([]),
});

export type ParentIssue = z.infer<typeof ParentIssueSchema>;

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
 * CI result from a workflow run
 */
export const CIResultSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
]);

export type CIResult = z.infer<typeof CIResultSchema>;

/**
 * Review decision from a PR review
 */
export const ReviewDecisionSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
]);

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

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

/**
 * Check if a status is terminal (no more work to do)
 */
export function isTerminalStatus(status: ProjectStatus): boolean {
  return status === "Done" || status === "Blocked" || status === "Error";
}

/**
 * Check if a status is a parent issue status
 */
export function isParentStatus(status: ProjectStatus): boolean {
  return (
    status === "Backlog" ||
    status === "In progress" ||
    status === "Done" ||
    status === "Blocked" ||
    status === "Error"
  );
}

/**
 * Check if a status is a sub-issue status
 */
export function isSubIssueStatus(status: ProjectStatus): boolean {
  return (
    status === "Ready" ||
    status === "In progress" ||
    status === "In review" ||
    status === "Done"
  );
}
