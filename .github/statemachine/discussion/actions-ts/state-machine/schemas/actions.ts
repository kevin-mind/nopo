import { z } from "zod";

/**
 * Token types for action authentication
 */
export const TokenTypeSchema = z.enum(["code", "admin"]);
export type TokenType = z.infer<typeof TokenTypeSchema>;

/**
 * Base action schema - all actions have a type and token
 */
const BaseActionSchema = z.object({
  type: z.string(),
  token: TokenTypeSchema,
});

// ============================================================================
// Artifact Schema (for passing data between matrix jobs)
// ============================================================================

/**
 * Artifact configuration for upload/download between matrix jobs
 */
const ArtifactSchema = z.object({
  name: z.string(),
  path: z.string(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

// ============================================================================
// Discussion Actions
// ============================================================================

/**
 * Add a comment to a GitHub Discussion
 */
const AddDiscussionCommentActionSchema = BaseActionSchema.extend({
  type: z.literal("addDiscussionComment"),
  discussionNodeId: z.string(),
  body: z.string(),
  replyToNodeId: z.string().optional(),
});

export type AddDiscussionCommentAction = z.infer<
  typeof AddDiscussionCommentActionSchema
>;

/**
 * Update a discussion's body (living document pattern)
 */
const UpdateDiscussionBodyActionSchema = BaseActionSchema.extend({
  type: z.literal("updateDiscussionBody"),
  discussionNodeId: z.string(),
  newBody: z.string(),
});

export type UpdateDiscussionBodyAction = z.infer<
  typeof UpdateDiscussionBodyActionSchema
>;

/**
 * Add a reaction to a discussion or comment
 */
const AddDiscussionReactionActionSchema = BaseActionSchema.extend({
  type: z.literal("addDiscussionReaction"),
  subjectId: z.string(),
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
      title: z.string(),
      body: z.string(),
      labels: z.array(z.string()),
    }),
  ),
});

export type CreateIssuesFromDiscussionAction = z.infer<
  typeof CreateIssuesFromDiscussionActionSchema
>;

// ============================================================================
// Apply Output Actions (for Claude output processing)
// ============================================================================

/**
 * Apply research output - creates research thread comments, investigates
 * them in parallel, posts findings as replies, and updates the body.
 */
const ApplyDiscussionResearchOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionResearchOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string(),
  /** Prompt variables to pass to investigation agents */
  promptVars: z.record(z.string()).optional(),
  filePath: z.string().optional(),
  consumesArtifact: ArtifactSchema.optional(),
});

export type ApplyDiscussionResearchOutputAction = z.infer<
  typeof ApplyDiscussionResearchOutputActionSchema
>;

/**
 * Apply respond output - posts a response to a comment
 */
const ApplyDiscussionRespondOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionRespondOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string(),
  replyToNodeId: z.string().optional(),
  filePath: z.string().optional(),
  consumesArtifact: ArtifactSchema.optional(),
});

export type ApplyDiscussionRespondOutputAction = z.infer<
  typeof ApplyDiscussionRespondOutputActionSchema
>;

/**
 * Apply summarize output - updates discussion body with summary
 */
const ApplyDiscussionSummarizeOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionSummarizeOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string(),
  filePath: z.string().optional(),
  consumesArtifact: ArtifactSchema.optional(),
});

export type ApplyDiscussionSummarizeOutputAction = z.infer<
  typeof ApplyDiscussionSummarizeOutputActionSchema
>;

/**
 * Apply plan output - creates issues from the plan
 */
const ApplyDiscussionPlanOutputActionSchema = BaseActionSchema.extend({
  type: z.literal("applyDiscussionPlanOutput"),
  discussionNumber: z.number().int().positive(),
  discussionNodeId: z.string(),
  filePath: z.string().optional(),
  consumesArtifact: ArtifactSchema.optional(),
});

export type ApplyDiscussionPlanOutputAction = z.infer<
  typeof ApplyDiscussionPlanOutputActionSchema
>;

// ============================================================================
// Run Claude Action
// ============================================================================

/**
 * Run Claude with a specific prompt
 */
const RunClaudeActionSchema = BaseActionSchema.extend({
  type: z.literal("runClaude"),
  promptDir: z.string(),
  promptsBase: z.string().optional(),
  promptVars: z.record(z.string()),
  issueNumber: z.number().int().positive().optional(),
  producesArtifact: ArtifactSchema.optional(),
});

export type RunClaudeAction = z.infer<typeof RunClaudeActionSchema>;

// ============================================================================
// Log Action
// ============================================================================

/**
 * Log a message (for debugging and audit trails)
 */
const LogActionSchema = BaseActionSchema.extend({
  type: z.literal("log"),
  level: z.enum(["debug", "info", "warning", "error"]),
  message: z.string(),
});

export type LogAction = z.infer<typeof LogActionSchema>;

// ============================================================================
// Union Schema
// ============================================================================

/**
 * All discussion action types
 */
export const DiscussionActionSchema = z.discriminatedUnion("type", [
  // Discussion actions
  AddDiscussionCommentActionSchema,
  UpdateDiscussionBodyActionSchema,
  AddDiscussionReactionActionSchema,
  CreateIssuesFromDiscussionActionSchema,
  // Apply output actions
  ApplyDiscussionResearchOutputActionSchema,
  ApplyDiscussionRespondOutputActionSchema,
  ApplyDiscussionSummarizeOutputActionSchema,
  ApplyDiscussionPlanOutputActionSchema,
  // Claude actions
  RunClaudeActionSchema,
  // Utility actions
  LogActionSchema,
]);

export type DiscussionAction = z.infer<typeof DiscussionActionSchema>;

/**
 * All action types for discussions
 */
export const DISCUSSION_ACTION_TYPES = [
  "addDiscussionComment",
  "updateDiscussionBody",
  "addDiscussionReaction",
  "createIssuesFromDiscussion",
  "applyDiscussionResearchOutput",
  "applyDiscussionRespondOutput",
  "applyDiscussionSummarizeOutput",
  "applyDiscussionPlanOutput",
  "runClaude",
  "log",
] as const;

export type DiscussionActionType = (typeof DISCUSSION_ACTION_TYPES)[number];
