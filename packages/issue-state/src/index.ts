// Schemas
export {
  ProjectStatusSchema,
  IssueStateSchema,
  PRStateSchema,
  CIStatusSchema,
  TodoItemSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
  SectionSchema,
  TableSchema,
  IssueCommentSchema,
  LinkedPRSchema,
  ProjectFieldsSchema,
  SubIssueDataSchema,
  IssueDataSchema,
  IssueStateDataSchema,
} from "./schemas/index.js";

export type {
  ProjectStatus,
  IssueState,
  PRState,
  CIStatus,
  TodoItem,
  TodoStats,
  HistoryEntry,
  AgentNotesEntry,
  Section,
  Table,
  IssueComment,
  LinkedPR,
  ProjectFields,
  SubIssueData,
  IssueData,
  IssueStateData,
} from "./schemas/index.js";

// Markdown parsers
export {
  getSection,
  removeSection,
  upsertSection,
  upsertSections,
  hasSection,
  STANDARD_SECTION_ORDER,
} from "./markdown/sections.js";

export {
  parseTodoLine,
  parseTodos,
  calculateTodoStats,
  parseTodoStats,
  parseTodosInSection,
  updateTodoInBody,
  addTodoToBody,
} from "./markdown/todos.js";

export {
  parseHistory,
  addHistoryEntry,
  updateHistoryEntry,
  createHistoryTable,
  getLatestHistoryEntry,
} from "./markdown/history.js";

export {
  parseAgentNotes,
  appendAgentNotes,
  removeAgentNotesSection,
  extractAgentNotesSection,
} from "./markdown/agent-notes.js";

export { parseTable, serializeTable } from "./markdown/tables.js";

export { parseBody } from "./markdown/body-parser.js";

export { serializeBody } from "./markdown/body-serializer.js";

// GraphQL
export {
  GET_ISSUE_WITH_PROJECT_QUERY,
  GET_PR_FOR_BRANCH_QUERY,
  CHECK_BRANCH_EXISTS_QUERY,
  GET_ISSUE_BODY_QUERY,
} from "./graphql/issue-queries.js";

export {
  CONVERT_PR_TO_DRAFT_MUTATION,
  MARK_PR_READY_MUTATION,
  GET_PR_ID_QUERY,
} from "./graphql/pr-queries.js";

export {
  GET_PROJECT_ITEM_QUERY,
  UPDATE_PROJECT_FIELD_MUTATION,
  ADD_ISSUE_TO_PROJECT_MUTATION,
} from "./graphql/project-queries.js";

export {
  CREATE_ISSUE_MUTATION,
  ADD_SUB_ISSUE_MUTATION,
  GET_REPO_ID_QUERY,
} from "./graphql/issue-mutations.js";

// Client
export type { OctokitLike } from "./client.js";

// Core API
export { parseIssue } from "./parse-issue.js";
export type { ParseIssueOptions } from "./parse-issue.js";
export { computeDiff } from "./diff.js";
export type { IssueDiff } from "./diff.js";
export { updateIssue } from "./update-issue.js";
