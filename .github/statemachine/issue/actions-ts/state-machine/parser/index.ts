// Todo parser
export {
  parseTodos,
  parseTodoStats,
  calculateTodoStats,
} from "./todo-parser.js";

// History parser
export {
  addHistoryEntry,
  updateHistoryEntry,
  parseHistory,
  createHistoryTable,
} from "./history-parser.js";

// Issue serializer - single source of truth for body parsing and serialization
export {
  parseDescription,
  parseApproach,
  parseParentIssue,
  parseSubIssue,
  serializeParentIssueBody,
  serializeSubIssueBody,
  serializeTodos,
  getParentIssueBody,
  getSubIssueBody,
  type ApiIssue,
  type ApiSubIssue,
} from "./issue-serializer.js";

// State parser
export {
  deriveBranchName,
  buildMachineContext,
  buildDiscussionContext,
  type BuildDiscussionContextOptions,
} from "./state-parser.js";

// Agent notes parser
export {
  parseAgentNotes,
  appendAgentNotes,
  formatAgentNotesForPrompt,
  removeAgentNotesSection,
  extractAgentNotesSection,
  AGENT_NOTES_SECTION,
  type AgentNotesEntry,
} from "./agent-notes-parser.js";
