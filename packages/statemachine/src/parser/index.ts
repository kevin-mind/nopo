// Todo parsing
export {
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
} from "./todo-parser.js";

// History parsing
export {
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
} from "./history-parser.js";

// Agent notes parsing
export {
  AGENT_NOTES_SECTION,
  parseAgentNotes,
  formatAgentNotesForPrompt,
  appendAgentNotes,
  removeAgentNotesSection,
  extractAgentNotesSection,
} from "./agent-notes-parser.js";

// Issue adapter
export {
  buildMachineContextFromIssue,
  deriveBranchName,
  type BuildContextOptions,
} from "./issue-adapter.js";

// State parser - has type errors that need fixing
// export { buildMachineContext } from "./state-parser.js";

// Section parser
export {
  getSection,
  removeSection,
  upsertSection,
  upsertSections,
  hasSection,
  formatRequirements,
  formatQuestions,
  formatRelated,
  STANDARD_SECTION_ORDER,
  type SectionContent,
} from "./section-parser.js";

// State parser - builds MachineContext from GitHub API
export {
  buildMachineContext,
  buildDiscussionContext,
  // Note: deriveBranchName is also exported from issue-adapter.ts
  // Use the one from issue-adapter for consistency
} from "./state-parser.js";
