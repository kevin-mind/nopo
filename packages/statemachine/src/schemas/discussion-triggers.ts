import { z } from "zod";

/**
 * Discussion trigger types
 *
 * These triggers are specific to the discussion automation state machine,
 * handling GitHub Discussions events.
 */
export const DiscussionTriggerTypeSchema = z.enum([
  "discussion-created",
  "discussion-comment",
  "discussion-command",
]);

export type DiscussionTriggerType = z.infer<typeof DiscussionTriggerTypeSchema>;

/**
 * All discussion trigger types as a const array for runtime use
 */
export const DISCUSSION_TRIGGER_TYPES = DiscussionTriggerTypeSchema.options;
