/**
 * Discussion Machine Guards
 *
 * Guard functions that determine state transitions in the discussion machine.
 * Guards check the context to decide which path to take.
 */

import type { DiscussionContext } from "../schemas/discussion-context.js";

/**
 * Guard context type for XState
 */
interface GuardContext {
  context: DiscussionContext;
}

// ============================================================================
// Trigger Guards
// ============================================================================

/**
 * Check if triggered by discussion creation
 */
function triggeredByDiscussionCreated({ context }: GuardContext): boolean {
  return context.trigger === "discussion-created";
}

/**
 * Check if triggered by a comment on a discussion
 */
function triggeredByDiscussionComment({ context }: GuardContext): boolean {
  return context.trigger === "discussion-comment";
}

/**
 * Check if triggered by a slash command on a discussion
 */
function triggeredByDiscussionCommand({ context }: GuardContext): boolean {
  return context.trigger === "discussion-command";
}

// ============================================================================
// Command Guards
// ============================================================================

/**
 * Check if the command is /summarize
 */
function commandIsSummarize({ context }: GuardContext): boolean {
  return context.discussion.command === "summarize";
}

/**
 * Check if the command is /plan
 */
function commandIsPlan({ context }: GuardContext): boolean {
  return context.discussion.command === "plan";
}

/**
 * Check if the command is /complete
 */
function commandIsComplete({ context }: GuardContext): boolean {
  return context.discussion.command === "complete";
}

// ============================================================================
// Author Guards
// ============================================================================

/**
 * Check if the comment is from a human (not a bot)
 */
function isHumanComment({ context }: GuardContext): boolean {
  const author = context.discussion.commentAuthor;
  if (!author) return false;
  // Bot accounts typically end with [bot] or are known bot usernames
  return !author.endsWith("[bot]") && author !== context.botUsername;
}

/**
 * Check if this is a bot's research thread comment
 * Research threads are created by the bot to investigate topics
 */
function isBotResearchThread({ context }: GuardContext): boolean {
  const author = context.discussion.commentAuthor;
  // If the comment is from a bot and it's a reply in a discussion
  return (
    (author === context.botUsername || author?.endsWith("[bot]") === true) &&
    context.trigger === "discussion-comment"
  );
}

// ============================================================================
// Discussion State Guards
// ============================================================================

/**
 * Check if discussion has valid context
 */
function hasDiscussionContext({ context }: GuardContext): boolean {
  return context.discussion !== null && context.discussion !== undefined;
}

/**
 * Check if discussion has a comment to respond to
 */
function hasComment({ context }: GuardContext): boolean {
  return (
    context.discussion.commentId !== undefined &&
    context.discussion.commentBody !== undefined
  );
}

/**
 * Export all discussion guards as a record for XState
 */
export const discussionGuards = {
  // Trigger guards
  triggeredByDiscussionCreated,
  triggeredByDiscussionComment,
  triggeredByDiscussionCommand,
  // Command guards
  commandIsSummarize,
  commandIsPlan,
  commandIsComplete,
  // Author guards
  isHumanComment,
  isBotResearchThread,
  // State guards
  hasDiscussionContext,
  hasComment,
};
