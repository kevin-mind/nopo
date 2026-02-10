/**
 * Parser module - provides statemachine-specific adapters and MDAST-based mutators/extractors.
 *
 * String-based section parsers from @more/issue-state are no longer re-exported.
 * Use MDAST mutators (checkOffTodo, addHistoryEntry, etc.) with parseIssue() + update() instead.
 */

// Re-export types that are still useful
export type {
  TodoItem,
  TodoStats,
  HistoryEntry,
  AgentNotesEntry,
  SectionContent,
  HistoryEntryOptions,
} from "@more/issue-state";

// Re-export schema types for validation
export {
  TodoItemSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
} from "@more/issue-state";

// String-based parsers still needed by callers (for prompt formatting)
export { formatAgentNotesForPrompt } from "@more/issue-state";

// Issue adapter (statemachine-specific)
export {
  buildMachineContextFromIssue,
  deriveBranchName,
  type BuildContextOptions,
} from "./issue-adapter.js";

// State parser - builds MachineContext from GitHub API
export { buildMachineContext, buildDiscussionContext } from "./state-parser.js";

// MDAST-based extractors (work directly with JSON, no serialize/re-parse)
export {
  todosExtractor,
  historyExtractor,
  agentNotesExtractor,
  extractTodosFromAst,
  questionsExtractor,
  extractQuestionsFromAst,
  extractQuestionItems,
  QuestionStatsSchema,
  type QuestionStats,
  type QuestionItem,
} from "./extractors.js";

// MDAST-based mutators (work directly with JSON, return new IssueStateData)
export {
  checkOffTodo,
  uncheckTodo,
  addTodo,
  addHistoryEntry,
  updateHistoryEntry,
  appendAgentNotes,
  upsertSection,
  applyTodoModifications,
  replaceBody,
} from "./mutators.js";
