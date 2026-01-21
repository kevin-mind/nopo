import { z } from "zod";
import { ProjectStatusSchema } from "./state.js";

/**
 * Base action fields shared by all actions
 */
const BaseActionSchema = z.object({
  id: z.string().uuid().optional(),
});

// ============================================================================
// Project Field Actions
// ============================================================================

/**
 * Update the Project Status field for an issue
 */
export const UpdateProjectStatusActionSchema = BaseActionSchema.extend({
  type: z.literal("updateProjectStatus"),
  issueNumber: z.number().int().positive(),
  status: ProjectStatusSchema,
});

export type UpdateProjectStatusAction = z.infer<
  typeof UpdateProjectStatusActionSchema
>;

/**
 * Increment the Iteration counter for an issue
 */
export const IncrementIterationActionSchema = BaseActionSchema.extend({
  type: z.literal("incrementIteration"),
  issueNumber: z.number().int().positive(),
});

export type IncrementIterationAction = z.infer<
  typeof IncrementIterationActionSchema
>;

/**
 * Record a failure (increment Failures counter)
 */
export const RecordFailureActionSchema = BaseActionSchema.extend({
  type: z.literal("recordFailure"),
  issueNumber: z.number().int().positive(),
  failureType: z.enum(["ci", "workflow", "review"]).optional(),
});

export type RecordFailureAction = z.infer<typeof RecordFailureActionSchema>;

/**
 * Clear failures (reset to 0)
 */
export const ClearFailuresActionSchema = BaseActionSchema.extend({
  type: z.literal("clearFailures"),
  issueNumber: z.number().int().positive(),
});

export type ClearFailuresAction = z.infer<typeof ClearFailuresActionSchema>;

// ============================================================================
// Issue Actions
// ============================================================================

/**
 * Phase definition for creating sub-issues
 */
export const PhaseDefinitionSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
});

export type PhaseDefinition = z.infer<typeof PhaseDefinitionSchema>;

/**
 * Create sub-issues for phased work
 */
export const CreateSubIssuesActionSchema = BaseActionSchema.extend({
  type: z.literal("createSubIssues"),
  parentIssueNumber: z.number().int().positive(),
  phases: z.array(PhaseDefinitionSchema).min(1),
});

export type CreateSubIssuesAction = z.infer<typeof CreateSubIssuesActionSchema>;

/**
 * Close an issue
 */
export const CloseIssueActionSchema = BaseActionSchema.extend({
  type: z.literal("closeIssue"),
  issueNumber: z.number().int().positive(),
  reason: z.enum(["completed", "not_planned"]).default("completed"),
});

export type CloseIssueAction = z.infer<typeof CloseIssueActionSchema>;

/**
 * Append an entry to the Iteration History table
 */
export const AppendHistoryActionSchema = BaseActionSchema.extend({
  type: z.literal("appendHistory"),
  issueNumber: z.number().int().positive(),
  phase: z.string(),
  message: z.string(),
  commitSha: z.string().optional(),
  runLink: z.string().optional(),
});

export type AppendHistoryAction = z.infer<typeof AppendHistoryActionSchema>;

/**
 * Update an existing history entry
 */
export const UpdateHistoryActionSchema = BaseActionSchema.extend({
  type: z.literal("updateHistory"),
  issueNumber: z.number().int().positive(),
  matchIteration: z.number().int().min(0),
  matchPhase: z.string(),
  matchPattern: z.string(),
  newMessage: z.string(),
  commitSha: z.string().optional(),
  runLink: z.string().optional(),
});

export type UpdateHistoryAction = z.infer<typeof UpdateHistoryActionSchema>;

/**
 * Update the issue body
 */
export const UpdateIssueBodyActionSchema = BaseActionSchema.extend({
  type: z.literal("updateIssueBody"),
  issueNumber: z.number().int().positive(),
  body: z.string(),
});

export type UpdateIssueBodyAction = z.infer<typeof UpdateIssueBodyActionSchema>;

/**
 * Add a comment to an issue
 */
export const AddCommentActionSchema = BaseActionSchema.extend({
  type: z.literal("addComment"),
  issueNumber: z.number().int().positive(),
  body: z.string(),
});

export type AddCommentAction = z.infer<typeof AddCommentActionSchema>;

/**
 * Unassign a user from an issue
 */
export const UnassignUserActionSchema = BaseActionSchema.extend({
  type: z.literal("unassignUser"),
  issueNumber: z.number().int().positive(),
  username: z.string().min(1),
});

export type UnassignUserAction = z.infer<typeof UnassignUserActionSchema>;

// ============================================================================
// Git Actions
// ============================================================================

/**
 * Create a new branch
 */
export const CreateBranchActionSchema = BaseActionSchema.extend({
  type: z.literal("createBranch"),
  branchName: z.string().min(1),
  baseBranch: z.string().default("main"),
});

export type CreateBranchAction = z.infer<typeof CreateBranchActionSchema>;

/**
 * Push commits to a branch
 */
export const GitPushActionSchema = BaseActionSchema.extend({
  type: z.literal("gitPush"),
  branchName: z.string().min(1),
  force: z.boolean().default(false),
});

export type GitPushAction = z.infer<typeof GitPushActionSchema>;

// ============================================================================
// PR Actions
// ============================================================================

/**
 * Create a pull request
 */
export const CreatePRActionSchema = BaseActionSchema.extend({
  type: z.literal("createPR"),
  title: z.string().min(1),
  body: z.string(),
  branchName: z.string().min(1),
  baseBranch: z.string().default("main"),
  draft: z.boolean().default(true),
  issueNumber: z.number().int().positive(),
});

export type CreatePRAction = z.infer<typeof CreatePRActionSchema>;

/**
 * Convert a PR to draft
 */
export const ConvertPRToDraftActionSchema = BaseActionSchema.extend({
  type: z.literal("convertPRToDraft"),
  prNumber: z.number().int().positive(),
});

export type ConvertPRToDraftAction = z.infer<
  typeof ConvertPRToDraftActionSchema
>;

/**
 * Mark a PR as ready for review
 */
export const MarkPRReadyActionSchema = BaseActionSchema.extend({
  type: z.literal("markPRReady"),
  prNumber: z.number().int().positive(),
});

export type MarkPRReadyAction = z.infer<typeof MarkPRReadyActionSchema>;

/**
 * Request a reviewer for a PR
 */
export const RequestReviewActionSchema = BaseActionSchema.extend({
  type: z.literal("requestReview"),
  prNumber: z.number().int().positive(),
  reviewer: z.string().min(1),
});

export type RequestReviewAction = z.infer<typeof RequestReviewActionSchema>;

/**
 * Merge a PR
 */
export const MergePRActionSchema = BaseActionSchema.extend({
  type: z.literal("mergePR"),
  prNumber: z.number().int().positive(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"),
});

export type MergePRAction = z.infer<typeof MergePRActionSchema>;

// ============================================================================
// Claude Actions
// ============================================================================

/**
 * Run Claude to work on an issue
 */
export const RunClaudeActionSchema = BaseActionSchema.extend({
  type: z.literal("runClaude"),
  prompt: z.string().min(1),
  issueNumber: z.number().int().positive(),
  allowedTools: z.array(z.string()).optional(),
  worktree: z.string().optional(),
});

export type RunClaudeAction = z.infer<typeof RunClaudeActionSchema>;

// ============================================================================
// Control Flow Actions
// ============================================================================

/**
 * Stop execution with a reason
 */
export const StopActionSchema = BaseActionSchema.extend({
  type: z.literal("stop"),
  reason: z.string().min(1),
});

export type StopAction = z.infer<typeof StopActionSchema>;

/**
 * Block an issue (circuit breaker)
 */
export const BlockActionSchema = BaseActionSchema.extend({
  type: z.literal("block"),
  issueNumber: z.number().int().positive(),
  reason: z.string().min(1),
});

export type BlockAction = z.infer<typeof BlockActionSchema>;

/**
 * Log a message (no-op, for debugging)
 */
export const LogActionSchema = BaseActionSchema.extend({
  type: z.literal("log"),
  level: z.enum(["debug", "info", "warning", "error"]).default("info"),
  message: z.string(),
});

export type LogAction = z.infer<typeof LogActionSchema>;

/**
 * No-op action (do nothing)
 */
export const NoOpActionSchema = BaseActionSchema.extend({
  type: z.literal("noop"),
  reason: z.string().optional(),
});

export type NoOpAction = z.infer<typeof NoOpActionSchema>;

// ============================================================================
// Discriminated Union of All Actions
// ============================================================================

/**
 * All possible action types as a discriminated union
 */
export const ActionSchema = z.discriminatedUnion("type", [
  // Project field actions
  UpdateProjectStatusActionSchema,
  IncrementIterationActionSchema,
  RecordFailureActionSchema,
  ClearFailuresActionSchema,
  // Issue actions
  CreateSubIssuesActionSchema,
  CloseIssueActionSchema,
  AppendHistoryActionSchema,
  UpdateHistoryActionSchema,
  UpdateIssueBodyActionSchema,
  AddCommentActionSchema,
  UnassignUserActionSchema,
  // Git actions
  CreateBranchActionSchema,
  GitPushActionSchema,
  // PR actions
  CreatePRActionSchema,
  ConvertPRToDraftActionSchema,
  MarkPRReadyActionSchema,
  RequestReviewActionSchema,
  MergePRActionSchema,
  // Claude actions
  RunClaudeActionSchema,
  // Control flow actions
  StopActionSchema,
  BlockActionSchema,
  LogActionSchema,
  NoOpActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;

/**
 * Array of actions to execute
 */
export const ActionArraySchema = z.array(ActionSchema);

export type ActionArray = z.infer<typeof ActionArraySchema>;

/**
 * Extract the action type string
 */
export type ActionType = Action["type"];

/**
 * All action types as a const array for runtime use
 */
export const ACTION_TYPES = [
  "updateProjectStatus",
  "incrementIteration",
  "recordFailure",
  "clearFailures",
  "createSubIssues",
  "closeIssue",
  "appendHistory",
  "updateHistory",
  "updateIssueBody",
  "addComment",
  "unassignUser",
  "createBranch",
  "gitPush",
  "createPR",
  "convertPRToDraft",
  "markPRReady",
  "requestReview",
  "mergePR",
  "runClaude",
  "stop",
  "block",
  "log",
  "noop",
] as const;

/**
 * Helper to create an action with type inference
 */
export function createAction<T extends ActionType>(
  type: T,
  params: Omit<Extract<Action, { type: T }>, "type">,
): Extract<Action, { type: T }> {
  return { type, ...params } as Extract<Action, { type: T }>;
}

/**
 * Actions that should stop further execution
 */
export function isTerminalAction(action: Action): boolean {
  return action.type === "stop" || action.type === "block";
}

/**
 * Actions that should stop on error
 */
export function shouldStopOnError(actionType: ActionType): boolean {
  const criticalActions: ActionType[] = [
    "runClaude",
    "createPR",
    "mergePR",
    "createSubIssues",
    "block",
  ];
  return criticalActions.includes(actionType);
}
