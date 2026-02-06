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
export const AgentNotesEntrySchema = z.object({
  runId: z.string(),
  runLink: z.string(),
  timestamp: z.string(),
  notes: z.array(z.string()),
});

export type AgentNotesEntry = z.infer<typeof AgentNotesEntrySchema>;

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

// ============================================================================
// Status Helpers
// ============================================================================

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
