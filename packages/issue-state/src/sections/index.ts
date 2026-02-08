// Types
export type {
  TodoItem,
  TodoStats,
  HistoryEntry,
  AgentNotesEntry,
  SectionContent,
} from "./types.js";

export {
  TodoItemSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
} from "./types.js";

// Section manipulation
export {
  getSection,
  removeSection,
  hasSection,
  upsertSection,
  upsertSections,
  STANDARD_SECTION_ORDER,
  formatRequirements,
  formatQuestions,
  formatRelated,
} from "./sections.js";

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
  checkOffTodoInBody,
  uncheckTodoInBody,
} from "./todos.js";

// History parsing
export {
  HISTORY_SECTION,
  formatHistoryCells,
  parseHistoryRow,
  parseHistory,
  getLatestHistoryEntry,
  createHistoryRow,
  createHistoryTable,
  addHistoryEntry,
  updateHistoryEntry,
  findHistoryEntries,
  getPhaseHistory,
  hasHistoryEntry,
} from "./history.js";

// Agent notes parsing
export {
  AGENT_NOTES_SECTION,
  parseAgentNotes,
  formatAgentNotesForPrompt,
  appendAgentNotes,
  removeAgentNotesSection,
  extractAgentNotesSection,
} from "./agent-notes.js";

// Builders and MDAST helpers
export {
  HistoryEntryBuilder,
  createText,
  createHeading,
  createParagraph,
  createListItem,
  createTodoList,
  createBulletList,
  createNumberedList,
  createSection,
  createTodoSection,
  createDescriptionSection,
  createRequirementsSection,
} from "./builders.js";
export type { HistoryEntryOptions, MdastNode } from "./builders.js";
