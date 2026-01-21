import { z } from "zod";

/**
 * Project field values for Status single-select field
 *
 * Parent issues use: Backlog, In Progress, Done, Blocked, Error
 * Sub-issues use: Ready, Working, Review, Done
 */
export const ProjectStatusSchema = z.enum([
  "Backlog",
  "In Progress",
  "Ready",
  "Working",
  "Review",
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
  sha: z.string().nullable(),
  runLink: z.string().nullable(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

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
});

export type ParentIssue = z.infer<typeof ParentIssueSchema>;

/**
 * GitHub event trigger types that can start the state machine
 */
export const TriggerTypeSchema = z.enum([
  "issue_assigned",
  "issue_edited",
  "issue_closed",
  "pr_review_requested",
  "pr_review_submitted",
  "pr_push",
  "workflow_run_completed",
  "issue_comment",
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

  // Review result (if triggered by pr_review_submitted)
  reviewDecision: ReviewDecisionSchema.nullable(),
  reviewerId: z.string().nullable(),

  // Branch info
  branch: z.string().nullable(),
  hasBranch: z.boolean(),

  // PR info (for the current phase/issue)
  pr: LinkedPRSchema.nullable(),
  hasPR: z.boolean(),

  // Config
  maxRetries: z.number().int().positive().default(5),
  botUsername: z.string().default("nopo-bot"),
});

export type MachineContext = z.infer<typeof MachineContextSchema>;

/**
 * Partial context for creating from parsed data
 */
export const PartialMachineContextSchema =
  MachineContextSchema.partial().required({
    trigger: true,
    owner: true,
    repo: true,
    issue: true,
  });

export type PartialMachineContext = z.infer<typeof PartialMachineContextSchema>;

/**
 * Default values for optional context fields
 */
export const DEFAULT_CONTEXT_VALUES: Partial<MachineContext> = {
  parentIssue: null,
  currentPhase: null,
  totalPhases: 0,
  currentSubIssue: null,
  ciResult: null,
  ciRunUrl: null,
  ciCommitSha: null,
  reviewDecision: null,
  reviewerId: null,
  branch: null,
  hasBranch: false,
  pr: null,
  hasPR: false,
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
    status === "In Progress" ||
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
    status === "Working" ||
    status === "Review" ||
    status === "Done"
  );
}
