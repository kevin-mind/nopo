/**
 * Universal Issue Serializer
 *
 * Single source of truth for bidirectional conversion between:
 * - GitHub API format (raw body string)
 * - Schema format (structured fields: description, approach, todos, history)
 *
 * API Format: Raw `body` string (markdown)
 * Schema Format: Structured fields (`description`, `approach`, `todos[]`, `history[]`)
 */

import type {
  ParentIssue,
  SubIssue,
  TodoItem,
  TodoStats,
  HistoryEntry,
  ProjectStatus,
  IssueState,
  LinkedPR,
} from "../schemas/index.js";
import { parseTodos, calculateTodoStats, parseTodoStats } from "./todo-parser.js";
import { parseHistory, createHistoryTable } from "./history-parser.js";
import { extractAgentNotesSection } from "./agent-notes-parser.js";

// ============================================================================
// Types for GitHub API responses
// ============================================================================

/** Raw issue data from GitHub GraphQL API */
export interface ApiIssue {
  number: number;
  title: string;
  body: string;
  state: string;
}

/** Raw sub-issue data from GitHub GraphQL API */
export interface ApiSubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
}

// ============================================================================
// Parsing: API → Schema (body string → structured fields)
// ============================================================================

/**
 * Parse description section from markdown body
 * Extracts content between "## Description" and the next section or end of file
 */
export function parseDescription(body: string): string {
  // First try to match until next section marker (## or <!--)
  // This handles empty sections correctly
  let match = body.match(/## Description\s*\n([\s\S]*?)(?=\n## |\n<!-- )/i);
  if (match) {
    return match[1]?.trim() || "";
  }

  // No next section marker - try to extract everything after ## Description
  match = body.match(/## Description\s*\n([\s\S]*)$/i);
  if (match) {
    return match[1]?.trim() || "";
  }

  // No description section found - return the whole body as description
  // (minus any known sections like Approach, Todo, Iteration History)
  const cleaned = body
    .replace(/## Approach[\s\S]*?(?=\n## |$)/gi, "")
    .replace(/## Todo[\s\S]*?(?=\n## |$)/gi, "")
    .replace(/## Iteration History[\s\S]*$/gi, "")
    .trim();

  return cleaned || body.trim();
}

/**
 * Parse approach section from markdown body
 * Returns null if no approach section is found
 */
export function parseApproach(body: string): string | null {
  const match = body.match(/## Approach\s*\n+([\s\S]*?)(?=\n## |\n<!-- |$)/i);
  return match?.[1]?.trim() || null;
}

/**
 * Parse a parent issue from API format to schema format
 *
 * @param api - Raw issue data from GitHub API
 * @param projectFields - Project status, iteration count, and failure count
 * @param subIssues - Already-parsed sub-issues
 * @param assignees - List of assignee usernames
 * @param labels - List of label names
 */
export function parseParentIssue(
  api: ApiIssue,
  projectFields: {
    status: ProjectStatus | null;
    iteration: number;
    failures: number;
  },
  subIssues: SubIssue[],
  assignees: string[],
  labels: string[],
): ParentIssue {
  const body = api.body || "";

  return {
    number: api.number,
    title: api.title,
    state: api.state.toUpperCase() as IssueState,
    body,
    // Parsed from body
    description: parseDescription(body),
    approach: parseApproach(body),
    history: parseHistory(body),
    todoStats: parseTodoStats(body),
    // From project fields
    projectStatus: projectFields.status,
    iteration: projectFields.iteration,
    failures: projectFields.failures,
    // From GraphQL
    assignees,
    labels,
    subIssues,
    hasSubIssues: subIssues.length > 0,
    // Legacy field kept for compatibility
    todos: parseTodoStats(body),
  };
}

/**
 * Parse a sub-issue from API format to schema format
 *
 * @param api - Raw sub-issue data from GitHub API
 * @param projectStatus - Project status field value
 * @param branch - Branch name (derived or explicit)
 * @param pr - Linked pull request (if any)
 */
export function parseSubIssue(
  api: ApiSubIssue,
  projectStatus: ProjectStatus | null,
  branch: string | null,
  pr: LinkedPR | null,
): SubIssue {
  const body = api.body || "";
  const todos = parseTodos(body);

  return {
    number: api.number,
    title: api.title,
    state: api.state.toUpperCase() as IssueState,
    body,
    // Parsed from body
    description: parseDescription(body),
    todos,
    todoStats: calculateTodoStats(todos),
    // From context
    projectStatus,
    branch,
    pr,
  };
}

// ============================================================================
// Serialization: Schema → API (structured fields → body string)
// ============================================================================

/**
 * Serialize a list of todo items to markdown
 */
export function serializeTodos(todos: TodoItem[]): string {
  return todos
    .map((t) => {
      const checkMark = t.checked ? "x" : " ";
      const manualPrefix = t.isManual ? "[Manual] " : "";
      return `- [${checkMark}] ${manualPrefix}${t.text}`;
    })
    .join("\n");
}

/**
 * Serialize parent issue fields to markdown body
 *
 * Note: If the original body had an "## Agent Notes" section, pass it via
 * agentNotesSection to preserve it at the end of the serialized body.
 */
export function serializeParentIssueBody(issue: {
  description: string;
  approach: string | null;
  history: HistoryEntry[];
  agentNotesSection?: string;
}): string {
  let body = `## Description\n\n${issue.description}`;

  if (issue.approach) {
    body += `\n\n## Approach\n\n${issue.approach}`;
  }

  // History table - use createHistoryTable which includes the section header
  if (issue.history.length > 0) {
    body += `\n\n${createHistoryTable(issue.history)}`;
  } else {
    body += "\n\n## Iteration History\n\n<!-- iteration_history_start -->\n<!-- iteration_history_end -->";
  }

  // Preserve agent notes section if provided
  if (issue.agentNotesSection) {
    body += `\n\n${issue.agentNotesSection}`;
  }

  return body;
}

/**
 * Serialize sub-issue fields to markdown body
 *
 * Note: If the original body had an "## Agent Notes" section, pass it via
 * agentNotesSection to preserve it at the end of the serialized body.
 */
export function serializeSubIssueBody(subIssue: {
  description: string;
  todos: TodoItem[];
  agentNotesSection?: string;
}): string {
  let body = `## Description\n\n${subIssue.description}\n\n## Todo\n\n`;
  body += serializeTodos(subIssue.todos);

  // Preserve agent notes section if provided
  if (subIssue.agentNotesSection) {
    body += `\n\n${subIssue.agentNotesSection}`;
  }

  return body;
}

// ============================================================================
// Convenience: Full round-trip helpers
// ============================================================================

/**
 * Get body string for updating parent issue via API
 *
 * Extracts structured fields from a ParentIssue and serializes them back to markdown.
 * Use this when you need to update an issue's body on GitHub.
 * Preserves any "## Agent Notes" section from the original body.
 */
export function getParentIssueBody(issue: ParentIssue): string {
  return serializeParentIssueBody({
    description: issue.description,
    approach: issue.approach,
    history: issue.history,
    agentNotesSection: extractAgentNotesSection(issue.body),
  });
}

/**
 * Get body string for updating sub-issue via API
 *
 * Extracts structured fields from a SubIssue and serializes them back to markdown.
 * Use this when you need to update a sub-issue's body on GitHub.
 * Preserves any "## Agent Notes" section from the original body.
 */
export function getSubIssueBody(subIssue: SubIssue): string {
  return serializeSubIssueBody({
    description: subIssue.description,
    todos: subIssue.todos,
    agentNotesSection: extractAgentNotesSection(subIssue.body),
  });
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { parseTodos, calculateTodoStats, parseTodoStats } from "./todo-parser.js";
export { parseHistory, createHistoryTable } from "./history-parser.js";
