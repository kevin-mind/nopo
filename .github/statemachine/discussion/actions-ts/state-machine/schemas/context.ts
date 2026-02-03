import { z } from "zod";
import { DiscussionTriggerTypeSchema } from "./triggers.js";

/**
 * Discussion command types
 */
export const DiscussionCommandSchema = z.enum([
  "summarize",
  "plan",
  "complete",
]);

export type DiscussionCommand = z.infer<typeof DiscussionCommandSchema>;

/**
 * Research thread in a discussion
 */
const ResearchThreadSchema = z.object({
  nodeId: z.string(),
  topic: z.string(),
  replyCount: z.number().int().min(0),
});

/**
 * Discussion schema - the full discussion object structure
 */
export const DiscussionSchema = z.object({
  number: z.number().int().positive(),
  nodeId: z.string(),
  title: z.string(),
  body: z.string(),
  commentCount: z.number().int().min(0).default(0),
  researchThreads: z.array(ResearchThreadSchema).default([]),
  command: DiscussionCommandSchema.optional(),
  commentId: z.string().optional(),
  commentBody: z.string().optional(),
  commentAuthor: z.string().optional(),
});

export type Discussion = z.infer<typeof DiscussionSchema>;

/**
 * Discussion machine context schema
 *
 * Contains all fields needed for the discussion automation state machine,
 * which handles GitHub Discussions research, responses, and commands.
 *
 * This is a lean context that only includes discussion-specific fields,
 * unlike the issue context which has many more fields for CI, PRs, etc.
 */
export const DiscussionContextSchema = z.object({
  // Trigger info
  trigger: DiscussionTriggerTypeSchema,

  // Repository info
  owner: z.string().min(1),
  repo: z.string().min(1),

  // Discussion being worked on
  discussion: DiscussionSchema,

  // Config
  maxRetries: z.number().int().positive().default(5),
  botUsername: z.string().default("nopo-bot"),
});

export type DiscussionContext = z.infer<typeof DiscussionContextSchema>;

/**
 * Default values for optional discussion context fields
 */
export const DISCUSSION_CONTEXT_DEFAULTS = {
  maxRetries: 5,
  botUsername: "nopo-bot",
} as const;

/**
 * Partial context for creating from parsed data
 * Required: trigger, owner, repo, discussion
 * All other fields are optional and will use defaults
 */
export type PartialDiscussionContext = Pick<
  DiscussionContext,
  "trigger" | "owner" | "repo" | "discussion"
> &
  Partial<Omit<DiscussionContext, "trigger" | "owner" | "repo" | "discussion">>;

/**
 * Helper to create a full discussion context from partial data
 */
export function createDiscussionContext(
  partial: PartialDiscussionContext,
): DiscussionContext {
  return DiscussionContextSchema.parse({
    ...DISCUSSION_CONTEXT_DEFAULTS,
    ...partial,
  });
}
