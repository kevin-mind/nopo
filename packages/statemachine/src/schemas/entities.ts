/**
 * Entity schemas for the state machine.
 *
 * Common types (TodoItem, HistoryEntry, etc.) are re-exported from @more/issue-state.
 * Statemachine-specific types (ParentIssue, SubIssue, etc.) are defined here.
 */

import { z } from "zod";

// Re-export common types from @more/issue-state
export {
  // Schema exports
  ProjectStatusSchema,
  IssueStateSchema,
  PRStateSchema,
  CIStatusSchema,
  TodoItemSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
  // Type exports
  type ProjectStatus,
  type IssueState,
  type PRState,
  type CIStatus,
  type TodoItem,
  type TodoStats,
  type HistoryEntry,
  type AgentNotesEntry,
} from "@more/issue-state";

// Import schemas we need to use in local types
import {
  ProjectStatusSchema,
  IssueStateSchema,
  CIStatusSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
} from "@more/issue-state";
import type { ProjectStatus } from "@more/issue-state";

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
 * Pull request associated with a sub-issue
 */
export const LinkedPRSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
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
