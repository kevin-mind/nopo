import { z } from "zod";
import { BaseMachineContextSchema } from "./base.js";
import { DiscussionTriggerTypeSchema } from "./discussion-triggers.js";

/**
 * Discussion schema - the full discussion object structure
 */
const DiscussionSchema = z.object({
  number: z.number().int().positive(),
  nodeId: z.string(),
  title: z.string(),
  body: z.string(),
  commentCount: z.number().int().min(0).default(0),
  researchThreads: z
    .array(
      z.object({
        nodeId: z.string(),
        topic: z.string(),
        replyCount: z.number().int().min(0),
      }),
    )
    .default([]),
  command: z.enum(["summarize", "plan", "complete"]).optional(),
  commentId: z.string().optional(),
  commentBody: z.string().optional(),
  commentAuthor: z.string().optional(),
});

type Discussion = z.infer<typeof DiscussionSchema>;

/**
 * Discussion machine context schema
 *
 * Contains all fields needed for the discussion automation state machine,
 * which handles GitHub Discussions research, responses, and commands.
 *
 * This is a lean context that only includes discussion-specific fields,
 * unlike the issue context which has many more fields for CI, PRs, etc.
 */
const DiscussionContextSchema = BaseMachineContextSchema.extend({
  // Trigger info
  trigger: DiscussionTriggerTypeSchema,

  // Discussion being worked on
  discussion: DiscussionSchema,
});

export type DiscussionContext = z.infer<typeof DiscussionContextSchema>;

/**
 * Default values for optional discussion context fields
 */
const DISCUSSION_CONTEXT_DEFAULTS = {
  maxRetries: 5,
  botUsername: "nopo-bot",
} as const;

/**
 * Partial context for creating from parsed data
 * Required: trigger, owner, repo, discussion
 * All other fields are optional and will use defaults
 */
type PartialDiscussionContext = Pick<
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
