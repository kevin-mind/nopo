// Constants
export {
  ISSUE_LABELS,
  PARENT_STATUS,
  SUB_ISSUE_STATUS,
  PROJECT_STATUS,
  CI_STATUS,
  PR_STATE,
  ISSUE_STATE,
  DEFAULT_PROJECT_FIELDS,
  DEFAULT_SUB_ISSUE_PROJECT_FIELDS,
  DEFAULT_BOT_USERNAME,
} from "./constants.js";
export type {
  IssueLabel,
  ParentStatus,
  SubIssueStatus,
  CIStatusValue,
  PRStateValue,
  IssueStateValue,
} from "./constants.js";

// Schemas
export {
  ProjectStatusSchema,
  IssueStateSchema,
  PRStateSchema,
  CIStatusSchema,
  MdastRootSchema,
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
  IssueComment,
  LinkedPR,
  ProjectFields,
  SubIssueData,
  IssueData,
  IssueStateData,
} from "./schemas/index.js";

// Markdown AST
export { parseMarkdown, serializeMarkdown } from "./markdown/ast.js";

// GraphQL
export {
  GET_ISSUE_WITH_PROJECT_QUERY,
  GET_PR_FOR_BRANCH_QUERY,
  CHECK_BRANCH_EXISTS_QUERY,
  GET_ISSUE_BODY_QUERY,
  GET_SUB_ISSUES_QUERY,
  GET_ISSUE_PROJECT_STATUS_QUERY,
  GET_REPOSITORY_INFO_QUERY,
  GET_ISSUE_LINKED_PRS_QUERY,
} from "./graphql/issue-queries.js";

export {
  CONVERT_PR_TO_DRAFT_MUTATION,
  MARK_PR_READY_MUTATION,
  GET_PR_ID_QUERY,
  GET_PR_REVIEWS_QUERY,
} from "./graphql/pr-queries.js";

export {
  GET_PROJECT_ITEM_QUERY,
  GET_PROJECT_FIELDS_QUERY,
  UPDATE_PROJECT_FIELD_MUTATION,
  ADD_ISSUE_TO_PROJECT_MUTATION,
} from "./graphql/project-queries.js";

export {
  CREATE_ISSUE_MUTATION,
  ADD_SUB_ISSUE_MUTATION,
  GET_REPO_ID_QUERY,
} from "./graphql/issue-mutations.js";

export {
  GET_DISCUSSION_ID_QUERY,
  GET_DISCUSSION_QUERY,
  GET_DISCUSSION_LABELS_QUERY,
  GET_DISCUSSION_CATEGORIES_QUERY,
  GET_DISCUSSION_COMMENTS_QUERY,
  ADD_DISCUSSION_COMMENT_MUTATION,
  ADD_DISCUSSION_REPLY_MUTATION,
  UPDATE_DISCUSSION_MUTATION,
  UPDATE_DISCUSSION_COMMENT_MUTATION,
  CREATE_DISCUSSION_MUTATION,
  ADD_REACTION_MUTATION,
} from "./graphql/discussion-queries.js";

export {
  GET_LABEL_IDS_QUERY,
  ADD_LABELS_MUTATION,
} from "./graphql/label-queries.js";

// Client
export type { OctokitLike } from "./client.js";

// Core API
export { parseIssue } from "./parse-issue.js";
export type { ParseIssueOptions } from "./parse-issue.js";
export { computeDiff } from "./diff.js";
export type { IssueDiff } from "./diff.js";
export { updateIssue } from "./update-issue.js";
export type { UpdateIssueOptions } from "./update-issue.js";
export { createIssue } from "./create-issue.js";
export type {
  CreateIssueInput,
  CreateIssueOptions,
  CreateIssueProjectFields,
  CreateIssueResult,
} from "./create-issue.js";

// Project helpers
export {
  getProjectFieldInfo,
  updateProjectFields,
  updateProjectField,
  addIssueToProject,
} from "./project-helpers.js";
export type { ProjectFieldInfo } from "./project-helpers.js";

// Body section parsers
export {
  // Types
  TodoItemSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
  // Section manipulation
  getSection,
  removeSection,
  hasSection,
  upsertSection,
  upsertSections,
  STANDARD_SECTION_ORDER,
  formatRequirements,
  formatQuestions,
  formatRelated,
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
  // Agent notes parsing
  AGENT_NOTES_SECTION,
  parseAgentNotes,
  formatAgentNotesForPrompt,
  appendAgentNotes,
  removeAgentNotesSection,
  extractAgentNotesSection,
} from "./sections/index.js";

export type {
  TodoItem,
  TodoStats,
  HistoryEntry,
  AgentNotesEntry,
  SectionContent,
  HistoryEntryOptions,
  MdastNode,
} from "./sections/index.js";

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
} from "./sections/index.js";
