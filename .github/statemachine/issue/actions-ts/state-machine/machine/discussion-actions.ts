import type { MachineContext, Action } from "../schemas/index.js";

/**
 * Action context type for XState actions
 */
interface ActionContext {
  context: MachineContext;
}

/**
 * Action result - actions to execute
 */
type ActionResult = Action[];

// ============================================================================
// Claude Actions for Discussions
// ============================================================================

/**
 * Emit action to run Claude for discussion research
 *
 * Creates research threads to investigate the discussion topic.
 * Uses the discussion-research prompt directory.
 */
export function emitRunClaudeResearch({
  context,
}: ActionContext): ActionResult {
  if (!context.discussion) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No discussion context for research",
      },
    ];
  }

  const promptVars: Record<string, string> = {
    DISCUSSION_NUMBER: String(context.discussion.number),
    DISCUSSION_NODE_ID: context.discussion.nodeId,
    DISCUSSION_TITLE: context.discussion.title,
    DISCUSSION_BODY: context.discussion.body,
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "discussion-research",
      promptVars,
      // Use discussion number as issue number for tracking
      issueNumber: context.discussion.number,
    },
    {
      type: "applyDiscussionResearchOutput",
      token: "code",
      discussionNumber: context.discussion.number,
      discussionNodeId: context.discussion.nodeId,
    },
  ];
}

/**
 * Emit action to run Claude to respond to a discussion comment
 *
 * Responds to a human's question or comment in the discussion.
 * Uses the discussion-respond prompt directory.
 */
export function emitRunClaudeRespond({ context }: ActionContext): ActionResult {
  if (!context.discussion) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No discussion context for respond",
      },
    ];
  }

  const promptVars: Record<string, string> = {
    DISCUSSION_NUMBER: String(context.discussion.number),
    DISCUSSION_NODE_ID: context.discussion.nodeId,
    DISCUSSION_TITLE: context.discussion.title,
    DISCUSSION_BODY: context.discussion.body,
    COMMENT_ID: context.discussion.commentId ?? "",
    COMMENT_BODY: context.discussion.commentBody ?? "",
    COMMENT_AUTHOR: context.discussion.commentAuthor ?? "",
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "discussion-respond",
      promptVars,
      issueNumber: context.discussion.number,
    },
    {
      type: "applyDiscussionRespondOutput",
      token: "code",
      discussionNumber: context.discussion.number,
      discussionNodeId: context.discussion.nodeId,
      replyToNodeId: context.discussion.commentId,
    },
  ];
}

/**
 * Emit action to run Claude to summarize a discussion
 *
 * Creates a comprehensive summary and updates the discussion body.
 * Uses the discussion-summarize prompt directory.
 */
export function emitRunClaudeSummarize({
  context,
}: ActionContext): ActionResult {
  if (!context.discussion) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No discussion context for summarize",
      },
    ];
  }

  const promptVars: Record<string, string> = {
    DISCUSSION_NUMBER: String(context.discussion.number),
    DISCUSSION_NODE_ID: context.discussion.nodeId,
    DISCUSSION_TITLE: context.discussion.title,
    DISCUSSION_BODY: context.discussion.body,
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "discussion-summarize",
      promptVars,
      issueNumber: context.discussion.number,
    },
    {
      type: "applyDiscussionSummarizeOutput",
      token: "code",
      discussionNumber: context.discussion.number,
      discussionNodeId: context.discussion.nodeId,
    },
  ];
}

/**
 * Emit action to run Claude to create a plan from discussion
 *
 * Creates issues from the discussion and posts a summary.
 * Uses the discussion-plan prompt directory.
 */
export function emitRunClaudePlan({ context }: ActionContext): ActionResult {
  if (!context.discussion) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No discussion context for plan",
      },
    ];
  }

  const promptVars: Record<string, string> = {
    DISCUSSION_NUMBER: String(context.discussion.number),
    DISCUSSION_NODE_ID: context.discussion.nodeId,
    DISCUSSION_TITLE: context.discussion.title,
    DISCUSSION_BODY: context.discussion.body,
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "discussion-plan",
      promptVars,
      issueNumber: context.discussion.number,
    },
    {
      type: "applyDiscussionPlanOutput",
      token: "code",
      discussionNumber: context.discussion.number,
      discussionNodeId: context.discussion.nodeId,
    },
  ];
}

/**
 * Emit action to complete a discussion
 *
 * Adds a rocket reaction and posts a completion comment.
 */
export function emitComplete({ context }: ActionContext): ActionResult {
  if (!context.discussion) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No discussion context for complete",
      },
    ];
  }

  const actions: Action[] = [];

  // Add rocket reaction to the command comment if present
  if (context.discussion.commentId) {
    actions.push({
      type: "addDiscussionReaction",
      token: "code",
      subjectId: context.discussion.commentId,
      content: "ROCKET",
    });
  }

  // Add completion comment
  actions.push({
    type: "addDiscussionComment",
    token: "code",
    discussionNodeId: context.discussion.nodeId,
    body: `This discussion has been marked as complete.

If you have additional questions, feel free to post a new comment!`,
  });

  return actions;
}

// ============================================================================
// Logging Actions
// ============================================================================

/**
 * Emit log action for research state
 */
export function emitLogResearching({ context }: ActionContext): ActionResult {
  return [
    {
      type: "log",
      token: "code",
      level: "info",
      message: `Researching discussion #${context.discussion?.number ?? "unknown"}`,
    },
  ];
}

/**
 * Emit log action for respond state
 */
export function emitLogResponding({ context }: ActionContext): ActionResult {
  return [
    {
      type: "log",
      token: "code",
      level: "info",
      message: `Responding to comment in discussion #${context.discussion?.number ?? "unknown"}`,
    },
  ];
}

/**
 * Emit log action for summarize state
 */
export function emitLogSummarizing({ context }: ActionContext): ActionResult {
  return [
    {
      type: "log",
      token: "code",
      level: "info",
      message: `Summarizing discussion #${context.discussion?.number ?? "unknown"}`,
    },
  ];
}

/**
 * Emit log action for plan state
 */
export function emitLogPlanning({ context }: ActionContext): ActionResult {
  return [
    {
      type: "log",
      token: "code",
      level: "info",
      message: `Creating plan from discussion #${context.discussion?.number ?? "unknown"}`,
    },
  ];
}

/**
 * Emit log action for complete state
 */
export function emitLogCompleting({ context }: ActionContext): ActionResult {
  return [
    {
      type: "log",
      token: "code",
      level: "info",
      message: `Completing discussion #${context.discussion?.number ?? "unknown"}`,
    },
  ];
}
