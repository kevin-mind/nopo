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

type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/**
 * GitHub issue state (OPEN or CLOSED)
 */
const IssueStateSchema = z.enum(["OPEN", "CLOSED"]);

type IssueState = z.infer<typeof IssueStateSchema>;

/**
 * Pull request state
 */
const PRStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"]);

type PRState = z.infer<typeof PRStateSchema>;

/**
 * Todo item parsed from issue body
 */
const TodoItemSchema = z.object({
  text: z.string(),
  checked: z.boolean(),
  isManual: z.boolean(),
});

type TodoItem = z.infer<typeof TodoItemSchema>;

/**
 * Aggregated todo statistics
 */
const TodoStatsSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  uncheckedNonManual: z.number().int().min(0),
});

type TodoStats = z.infer<typeof TodoStatsSchema>;

/**
 * Iteration history entry from the history table
 */
const HistoryEntrySchema = z.object({
  iteration: z.number().int().min(0),
  phase: z.string(),
  action: z.string(),
  timestamp: z.string().nullable(),
  sha: z.string().nullable(),
  runLink: z.string().nullable(),
});

type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

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
 * Status check rollup state from GitHub GraphQL API
 */
const CIStatusSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "PENDING",
  "ERROR",
  "EXPECTED",
]);

/**
 * Pull request associated with a sub-issue
 */
const LinkedPRSchema = z.object({
  number: z.number().int().positive(),
  state: PRStateSchema,
  isDraft: z.boolean(),
  title: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  // CI status from statusCheckRollup
  ciStatus: CIStatusSchema.nullable().optional(),
});

type LinkedPR = z.infer<typeof LinkedPRSchema>;

/**
 * Sub-issue state representing a single phase of work
 *
 * Contains both raw body (for backward compatibility) and structured fields
 * parsed from the body content.
 */
const SubIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: IssueStateSchema,
  /** Raw markdown body - kept for backward compatibility */
  body: z.string(),
  projectStatus: ProjectStatusSchema.nullable(),
  branch: z.string().nullable(),
  pr: LinkedPRSchema.nullable(),
  // Structured fields parsed from body
  /** Description extracted from "## Description" section */
  description: z.string().default(""),
  /** Full list of todo items parsed from body */
  todos: z.array(TodoItemSchema).default([]),
  /** Aggregated todo statistics */
  todoStats: TodoStatsSchema.default({
    total: 0,
    completed: 0,
    uncheckedNonManual: 0,
  }),
});

type SubIssue = z.infer<typeof SubIssueSchema>;

/**
 * Parent issue state - the main issue being worked on
 *
 * Contains both raw body (for backward compatibility) and structured fields
 * parsed from the body content. Note: This is also used for sub-issues when
 * they are the trigger target.
 */
const ParentIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: IssueStateSchema,
  /** Raw markdown body - kept for backward compatibility */
  body: z.string(),
  projectStatus: ProjectStatusSchema.nullable(),
  iteration: z.number().int().min(0),
  failures: z.number().int().min(0),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  subIssues: z.array(SubIssueSchema),
  hasSubIssues: z.boolean(),
  history: z.array(HistoryEntrySchema),
  // Structured fields parsed from body
  /** Description extracted from "## Description" section */
  description: z.string().default(""),
  /** Approach extracted from "## Approach" section (if present) */
  approach: z.string().nullable().default(null),
  /** Aggregated todo statistics */
  todoStats: TodoStatsSchema.default({
    total: 0,
    completed: 0,
    uncheckedNonManual: 0,
  }),
  /** @deprecated Use todoStats instead - kept for backward compatibility */
  todos: TodoStatsSchema,
  /** Agent notes from previous workflow runs */
  agentNotes: z.array(AgentNotesEntrySchema).default([]),
});

type ParentIssue = z.infer<typeof ParentIssueSchema>;

/**
 * CI result from a workflow run
 */
const CIResultSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
]);

type CIResult = z.infer<typeof CIResultSchema>;

/**
 * Review decision from a PR review
 */
const ReviewDecisionSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
]);

type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

// ============================================================================
// Status Helpers
// ============================================================================

/**
 * Check if a status is terminal (no more work to do)
 */
function isTerminalStatus(status: ProjectStatus): boolean {
  return status === "Done" || status === "Blocked" || status === "Error";
}

/**
 * Check if a status is a parent issue status
 */
function isParentStatus(status: ProjectStatus): boolean {
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
function isSubIssueStatus(status: ProjectStatus): boolean {
  return (
    status === "Ready" ||
    status === "In progress" ||
    status === "In review" ||
    status === "Done"
  );
}
