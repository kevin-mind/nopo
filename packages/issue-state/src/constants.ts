/**
 * Shared constants for issue management.
 * Used by both state machine and test runner for consistent issue handling.
 */

// ============================================================================
// Issue Labels
// ============================================================================

/**
 * Standard labels used in the issue management workflow.
 */
export const ISSUE_LABELS = {
  // Workflow state labels
  TRIAGED: "triaged",
  GROOMED: "groomed",

  // Type labels
  ENHANCEMENT: "enhancement",
  BUG: "bug",
  DOCUMENTATION: "documentation",
  QUESTION: "question",
  CHORE: "chore",

  // Priority labels
  PRIORITY_LOW: "priority:low",
  PRIORITY_MEDIUM: "priority:medium",
  PRIORITY_HIGH: "priority:high",
  PRIORITY_CRITICAL: "priority:critical",

  // Size labels
  SIZE_XS: "size:xs",
  SIZE_S: "size:s",
  SIZE_M: "size:m",
  SIZE_L: "size:l",
  SIZE_XL: "size:xl",

  // Test labels
  TEST_AUTOMATION: "test:automation",
} as const;

export type IssueLabel = (typeof ISSUE_LABELS)[keyof typeof ISSUE_LABELS];

// ============================================================================
// Project Status Values
// ============================================================================

/**
 * Project status values for parent issues.
 * These map to the GitHub Project "Status" single-select field options.
 */
export const PARENT_STATUS = {
  BACKLOG: "Backlog",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  BLOCKED: "Blocked",
  ERROR: "Error",
} as const;

export type ParentStatus = (typeof PARENT_STATUS)[keyof typeof PARENT_STATUS];

/**
 * Project status values for sub-issues (phases).
 * These map to the GitHub Project "Status" single-select field options.
 */
export const SUB_ISSUE_STATUS = {
  READY: "Ready",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
} as const;

export type SubIssueStatus =
  (typeof SUB_ISSUE_STATUS)[keyof typeof SUB_ISSUE_STATUS];

/**
 * All possible project status values (union of parent and sub-issue statuses).
 */
export const PROJECT_STATUS = {
  ...PARENT_STATUS,
  ...SUB_ISSUE_STATUS,
} as const;

// ============================================================================
// CI Status Values
// ============================================================================

/**
 * CI check status values as returned by GitHub.
 */
export const CI_STATUS = {
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  PENDING: "PENDING",
  ERROR: "ERROR",
  EXPECTED: "EXPECTED",
} as const;

export type CIStatusValue = (typeof CI_STATUS)[keyof typeof CI_STATUS];

// ============================================================================
// PR States
// ============================================================================

/**
 * Pull request states.
 */
export const PR_STATE = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  MERGED: "MERGED",
} as const;

export type PRStateValue = (typeof PR_STATE)[keyof typeof PR_STATE];

// ============================================================================
// Issue States
// ============================================================================

/**
 * Issue states.
 */
export const ISSUE_STATE = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
} as const;

export type IssueStateValue = (typeof ISSUE_STATE)[keyof typeof ISSUE_STATE];

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default project field values for new issues.
 */
export const DEFAULT_PROJECT_FIELDS = {
  status: PARENT_STATUS.BACKLOG,
  iteration: 0,
  failures: 0,
} as const;

/**
 * Default project field values for new sub-issues.
 */
export const DEFAULT_SUB_ISSUE_PROJECT_FIELDS = {
  status: SUB_ISSUE_STATUS.READY,
} as const;

// ============================================================================
// Bot Username
// ============================================================================

/**
 * Default bot username for automated workflows.
 */
export const DEFAULT_BOT_USERNAME = "nopo-bot";
