/**
 * Entity schemas for the state machine.
 *
 * These schemas are now aligned with @more/issue-state.
 * ParentIssue and SubIssue use bodyAst (MDAST) instead of body (string).
 * Extracted fields (todos, history, agentNotes) are accessed via extractors.
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
  MdastRootSchema,
  // Issue schemas
  IssueDataSchema,
  SubIssueDataSchema,
  IssueCommentSchema,
  LinkedPRSchema,
  // Type exports
  type ProjectStatus,
  type IssueState,
  type PRState,
  type CIStatus,
  type TodoItem,
  type TodoStats,
  type HistoryEntry,
  type AgentNotesEntry,
  type IssueData,
  type SubIssueData,
  type IssueComment,
  type LinkedPR,
} from "@more/issue-state";

// Import for local use
import type { ProjectStatus } from "@more/issue-state";

/**
 * ParentIssue is now an alias for IssueData from @more/issue-state.
 *
 * Key changes from the old schema:
 * - Uses `bodyAst` (MDAST) instead of `body` (string)
 * - Removed inline `todos`, `history`, `agentNotes` - use extractors instead
 * - Added `branch`, `pr`, `parentIssueNumber` fields
 *
 * @deprecated Use IssueData directly from @more/issue-state
 */
export { IssueDataSchema as ParentIssueSchema } from "@more/issue-state";
export type { IssueData as ParentIssue } from "@more/issue-state";

/**
 * SubIssue is now an alias for SubIssueData from @more/issue-state.
 *
 * Key changes from the old schema:
 * - Uses `bodyAst` (MDAST) instead of `body` (string)
 * - Removed inline `todos` - use extractors instead
 *
 * @deprecated Use SubIssueData directly from @more/issue-state
 */
export { SubIssueDataSchema as SubIssueSchema } from "@more/issue-state";
export type { SubIssueData as SubIssue } from "@more/issue-state";

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
