/**
 * Parser module - re-exports body section parsers from @more/issue-state
 * and provides statemachine-specific adapters.
 */

// Re-export all section parsers from @more/issue-state
export {
  // Todo parsing
  parseTodoLine,
  parseTodos,
  calculateTodoStats,
  parseTodoStats,
  countNonManualUncheckedTodos,
  areNonManualTodosDone,
  parseTodosInSection,
  parseTodoStatsInSection,
  parseTodoSection,
  parseTestingSection,
  updateTodoInBody,
  addTodoToBody,
  checkOffTodoInBody,
  uncheckTodoInBody,
  // History parsing
  HISTORY_SECTION,
  parseHistory,
  parseHistoryRow,
  getLatestHistoryEntry,
  addHistoryEntry,
  updateHistoryEntry,
  createHistoryRow,
  createHistoryTable,
  findHistoryEntries,
  getPhaseHistory,
  hasHistoryEntry,
  formatHistoryCells,
  // Agent notes parsing
  AGENT_NOTES_SECTION,
  parseAgentNotes,
  formatAgentNotesForPrompt,
  appendAgentNotes,
  removeAgentNotesSection,
  extractAgentNotesSection,
  // Section manipulation
  getSection,
  removeSection,
  upsertSection,
  upsertSections,
  hasSection,
  formatRequirements,
  formatQuestions,
  formatRelated,
  STANDARD_SECTION_ORDER,
  // Types
  type TodoItem,
  type TodoStats,
  type HistoryEntry,
  type AgentNotesEntry,
  type SectionContent,
  // Builders
  HistoryEntryBuilder,
  type HistoryEntryOptions,
} from "@more/issue-state";

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
} from "./extractors.js";

// MDAST-based mutators (work directly with JSON, return new IssueStateData)
export {
  checkOffTodo,
  uncheckTodo,
  addTodo,
  addHistoryEntry as addHistoryEntryMutator,
  updateHistoryEntry as updateHistoryEntryMutator,
  appendAgentNotes as appendAgentNotesMutator,
  upsertSection as upsertSectionMutator,
} from "./mutators.js";
