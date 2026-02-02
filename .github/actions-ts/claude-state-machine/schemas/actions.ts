import { z } from "zod";
import { ProjectStatusSchema } from "./state.js";

/**
 * Token type for action execution
 *
 * - `code`: For code operations (push, PR creation, project fields, etc.)
 *           Uses NOPO_BOT_PAT - the account that writes code
 * - `review`: For review operations (submitting PR reviews)
 *             Uses CLAUDE_REVIEWER_PAT - a separate account that can review bot's PRs
 */
const TokenTypeSchema = z.enum(["code", "review"]);

export type TokenType = z.infer<typeof TokenTypeSchema>;

/**
 * Artifact definition for passing files between matrix jobs
 */
const ArtifactSchema = z.object({
  /** Unique name for the artifact (used for upload/download matching) */
  name: z.string(),
  /** Path to the file (relative to workspace) */
  path: z.string(),
});

/**
 * Base action fields shared by all actions
 */
const BaseActionSchema = z.object({
  id: z.string().uuid().optional(),
  /** Which token to use for this action (defaults to 'code') */
  token: TokenTypeSchema.default("code"),
  /** Artifact this action produces (will be uploaded after execution) */
  producesArtifact: ArtifactSchema.optional(),
  /** Artifact this action consumes (will be downloaded before execution) */
  consumesArtifact: ArtifactSchema.optional(),
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
const PhaseDefinitionSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
});

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
  /** Iteration number from project field */
  iteration: z.number().int().min(0).optional(),
  phase: z.string(),
  message: z.string(),
  /** ISO 8601 timestamp of when the workflow started */
  timestamp: z.string().optional(),
  commitSha: z.string().optional(),
  /** PR number to link in the SHA column (alternative to commitSha) */
  prNumber: z.number().int().positive().nullable().optional(),
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
  /** ISO 8601 timestamp (optional - preserves existing if not provided) */
  timestamp: z.string().optional(),
  commitSha: z.string().optional(),
  /** PR number to link in the SHA column (alternative to commitSha) */
  prNumber: z.number().int().positive().nullable().optional(),
  runLink: z.string().optional(),
});

export type UpdateHistoryAction = z.infer<typeof UpdateHistoryActionSchema>;

/**
 * Update the issue body
 */
const UpdateIssueBodyActionSchema = BaseActionSchema.extend({
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

/**
 * Assign a user to an issue
 * Used by orchestration to trigger iteration on sub-issues
 */
export const AssignUserActionSchema = BaseActionSchema.extend({
  type: z.literal("assignUser"),
  issueNumber: z.number().int().positive(),
  username: z.string().min(1),
});

export type AssignUserAction = z.infer<typeof AssignUserActionSchema>;

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
 * Mark a PR as ready for merge (human action required)
 * Adds "ready-to-merge" label and updates iteration history
 */
export const MergePRActionSchema = BaseActionSchema.extend({
  type: z.literal("mergePR"),
  prNumber: z.number().int().positive(),
  issueNumber: z.number().int().positive(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"),
});

export type MergePRAction = z.infer<typeof MergePRActionSchema>;

/**
 * Submit a PR review (approve, request changes, or comment)
 */
const SubmitReviewActionSchema = BaseActionSchema.extend({
  type: z.literal("submitReview"),
  prNumber: z.number().int().positive(),
  decision: z.enum(["approve", "request_changes", "comment"]),
  body: z.string(),
});

export type SubmitReviewAction = z.infer<typeof SubmitReviewActionSchema>;

/**
 * Remove a reviewer from a PR
 * Used when converting PR to draft to clear stale review requests
 */
const RemoveReviewerActionSchema = BaseActionSchema.extend({
  type: z.literal("removeReviewer"),
  prNumber: z.number().int().positive(),
  reviewer: z.string().min(1),
});

export type RemoveReviewerAction = z.infer<typeof RemoveReviewerActionSchema>;

// ============================================================================
// Claude Actions
// ============================================================================

/**
 * Run Claude to work on an issue
 *
 * Note: One of `prompt`, `promptFile`, or `promptDir` must be provided at runtime.
 * This is validated by the executor since Zod refinements can't be
 * used with discriminated unions.
 */
export const RunClaudeActionSchema = BaseActionSchema.extend({
  type: z.literal("runClaude"),
  /** Direct prompt string */
  prompt: z.string().min(1).optional(),
  /** Path to prompt file (relative to repo root) - will be read and substituted */
  promptFile: z.string().min(1).optional(),
  /** Prompt directory name (resolved to .github/prompts/{name}/) - contains prompt.txt and optional outputs.json */
  promptDir: z.string().min(1).optional(),
  /** Template variables for prompt substitution */
  promptVars: z.record(z.string()).optional(),
  issueNumber: z.number().int().positive(),
  allowedTools: z.array(z.string()).optional(),
  worktree: z.string().optional(),
});

export type RunClaudeAction = z.infer<typeof RunClaudeActionSchema>;

// ============================================================================
// Discussion Actions
// ============================================================================

/**
 * Add a comment to a GitHub Discussion
 * Supports threading via replyToNodeId
 */
const AddDiscussionCommentActionSchema = BaseActionSchema.extend({
  type: z.literal("addDiscussionComment"),
  discussionNodeId: z.string().min(1),
  body: z.string().min(1),
  /** If provided, this comment is a reply to another comment */
  replyToNodeId: z.string().optional(),
});

export type AddDiscussionCommentAction = z.infer<
  typeof AddDiscussionCommentActionSchema
>;

/**
 * Update the body of a GitHub Discussion
 * Used for maintaining the "living document" pattern
 */
const UpdateDiscussionBodyActionSchema = BaseActionSchema.extend({
  type: z.literal("updateDiscussionBody"),
  discussionNodeId: z.string().min(1),
  newBody: z.string().min(1),
});

export type UpdateDiscussionBodyAction = z.infer<
  typeof UpdateDiscussionBodyActionSchema
>;

/**
 * Add a reaction to a discussion or comment
 */
const AddDiscussionReactionActionSchema = BaseActionSchema.extend({
  type: z.literal("addDiscussionReaction"),
  /** Node ID of the discussion or comment */
  subjectId: z.string().min(1),
  content: z.enum([
    "THUMBS_UP",
    "THUMBS_DOWN",
    "LAUGH",
    "HOORAY",
    "CONFUSED",
    "HEART",
    "ROCKET",
    "EYES",
  ]),
});

export type AddDiscussionReactionAction = z.infer<
  typeof AddDiscussionReactionActionSchema
>;

/**
 * Create issues from a discussion (for /plan command)
 */
const CreateIssuesFromDiscussionActionSchema = BaseActionSchema.extend({
  type: z.literal("createIssuesFromDiscussion"),
  discussionNumber: z.number().int().positive(),
  issues: z.array(
    z.object({
      title: z.string().min(1),
      body: z.string(),
      labels: z.array(z.string()).default([]),
    }),
  ),
});

export type CreateIssuesFromDiscussionAction = z.infer<
  typeof CreateIssuesFromDiscussionActionSchema
>;

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

/**
 * No-op action (do nothing)
 */
export const NoOpActionSchema = BaseActionSchema.extend({
  type: z.literal("noop"),
  reason: z.string().optional(),
});

// ============================================================================
// Triage Actions
// ============================================================================

/**
 * Apply triage output from triage-output.json
 * Applies labels and project fields based on Claude's triage decisions
 */
const ApplyTriageOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyTriageOutput"),
  issueNumber: z.number().int().positive(),
  filePath: z.string().default("triage-output.json"),
});

export type ApplyTriageOutputAction = z.infer<
  typeof ApplyTriageOutputActionSchema
>;

/**
 * Apply iterate output from Claude's structured output
 * Checks off completed todos and stores agent notes in history
 */
const ApplyIterateOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyIterateOutput"),
  issueNumber: z.number().int().positive(),
});

export type ApplyIterateOutputAction = z.infer<
  typeof ApplyIterateOutputActionSchema
>;

/**
 * Apply review output from Claude's structured output
 * Submits the PR review using the decision and body from Claude
 */
const ApplyReviewOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyReviewOutput"),
  prNumber: z.number().int().positive(),
});

export type ApplyReviewOutputAction = z.infer<
  typeof ApplyReviewOutputActionSchema
>;

// ============================================================================
// Discussion Apply Actions
// ============================================================================

/**
 * Apply discussion research output from Claude's structured output
 * Creates research thread comments from Claude's analysis
 */
const ApplyDiscussionResearchOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionResearchOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string().min(1),
});

export type ApplyDiscussionResearchOutputAction = z.infer<
  typeof ApplyDiscussionResearchOutputActionSchema
>;

/**
 * Apply discussion respond output from Claude's structured output
 * Posts a response comment (optionally as a reply to a thread)
 */
const ApplyDiscussionRespondOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionRespondOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string().min(1),
  /** If provided, post as a reply to this comment */
  replyToNodeId: z.string().optional(),
});

export type ApplyDiscussionRespondOutputAction = z.infer<
  typeof ApplyDiscussionRespondOutputActionSchema
>;

/**
 * Apply discussion summarize output from Claude's structured output
 * Updates the discussion body with a summary
 */
const ApplyDiscussionSummarizeOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionSummarizeOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string().min(1),
});

export type ApplyDiscussionSummarizeOutputAction = z.infer<
  typeof ApplyDiscussionSummarizeOutputActionSchema
>;

/**
 * Apply discussion plan output from Claude's structured output
 * Creates issues from the plan and posts a summary comment
 */
const ApplyDiscussionPlanOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionPlanOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string().min(1),
});

export type ApplyDiscussionPlanOutputAction = z.infer<
  typeof ApplyDiscussionPlanOutputActionSchema
>;

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
  AssignUserActionSchema,
  // Git actions
  CreateBranchActionSchema,
  GitPushActionSchema,
  // PR actions
  CreatePRActionSchema,
  ConvertPRToDraftActionSchema,
  MarkPRReadyActionSchema,
  RequestReviewActionSchema,
  MergePRActionSchema,
  SubmitReviewActionSchema,
  RemoveReviewerActionSchema,
  // Claude actions
  RunClaudeActionSchema,
  // Discussion actions
  AddDiscussionCommentActionSchema,
  UpdateDiscussionBodyActionSchema,
  AddDiscussionReactionActionSchema,
  CreateIssuesFromDiscussionActionSchema,
  // Control flow actions
  StopActionSchema,
  BlockActionSchema,
  LogActionSchema,
  NoOpActionSchema,
  // Triage actions
  ApplyTriageOutputActionSchema,
  // Iterate actions
  ApplyIterateOutputActionSchema,
  // Review actions
  ApplyReviewOutputActionSchema,
  // Discussion apply actions
  ApplyDiscussionResearchOutputActionSchema,
  ApplyDiscussionRespondOutputActionSchema,
  ApplyDiscussionSummarizeOutputActionSchema,
  ApplyDiscussionPlanOutputActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;

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
  "assignUser",
  "createBranch",
  "gitPush",
  "createPR",
  "convertPRToDraft",
  "markPRReady",
  "requestReview",
  "mergePR",
  "submitReview",
  "removeReviewer",
  "runClaude",
  "addDiscussionComment",
  "updateDiscussionBody",
  "addDiscussionReaction",
  "createIssuesFromDiscussion",
  "stop",
  "block",
  "log",
  "noop",
  "applyTriageOutput",
  "applyIterateOutput",
  "applyReviewOutput",
  "applyDiscussionResearchOutput",
  "applyDiscussionRespondOutput",
  "applyDiscussionSummarizeOutput",
  "applyDiscussionPlanOutput",
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
