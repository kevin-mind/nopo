/**
 * Status Signaler
 *
 * Manages status comments for workflow progress indication.
 */

import * as core from "@actions/core";
import {
  GET_DISCUSSION_ID_QUERY,
  ADD_DISCUSSION_COMMENT_MUTATION,
  UPDATE_DISCUSSION_COMMENT_MUTATION,
  ADD_REACTION_MUTATION,
} from "@more/issue-state";
import type {
  Octokit,
  ResourceType,
  RunnerJobResult,
  ProgressInfo,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

interface SignalContext {
  octokit: Octokit;
  owner: string;
  repo: string;
  resourceType: ResourceType;
  resourceNumber: number;
  job: string;
  runUrl: string;
  triggerCommentId?: string;
}

// ============================================================================
// Job Descriptions
// ============================================================================

const JOB_DESCRIPTIONS: Record<string, string> = {
  // Issue jobs
  "issue-triage": "triaging this issue",
  "issue-iterate": "iterating on this issue",
  "issue-comment": "responding to your request",
  "issue-orchestrate": "orchestrating this issue",
  // PR jobs
  "push-to-draft": "converting PR to draft",
  "pr-review": "reviewing this PR",
  "pr-response": "responding to review feedback",
  "pr-human-response": "addressing your review feedback",
  // Discussion jobs
  "discussion-research": "researching this topic",
  "discussion-respond": "responding to your question",
  "discussion-summarize": "summarizing this discussion",
  "discussion-plan": "creating implementation plan",
  "discussion-complete": "marking discussion as complete",
};

interface DiscussionIdResponse {
  repository?: {
    discussion?: {
      id?: string;
    };
  };
}

interface AddCommentResponse {
  addDiscussionComment?: {
    comment?: {
      id?: string;
    };
  };
}

// ============================================================================
// Reactions
// ============================================================================

type ReactionType = "eyes" | "rocket" | "-1";
type GraphQLReactionContent = "EYES" | "ROCKET" | "THUMBS_DOWN";

function toGraphQLReaction(reaction: ReactionType): GraphQLReactionContent {
  switch (reaction) {
    case "eyes":
      return "EYES";
    case "rocket":
      return "ROCKET";
    case "-1":
      return "THUMBS_DOWN";
  }
}

async function addReactionToComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: string,
  resourceType: ResourceType,
  reaction: ReactionType,
): Promise<void> {
  try {
    if (resourceType === "discussion") {
      // Use GraphQL for discussion comment reactions
      await octokit.graphql(ADD_REACTION_MUTATION, {
        subjectId: commentId,
        content: toGraphQLReaction(reaction),
      });
    } else {
      // Use REST API for issue/PR comment reactions
      await octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: parseInt(commentId, 10),
        content: reaction,
      });
    }
    core.debug(`Added ${reaction} reaction to comment ${commentId}`);
  } catch (error) {
    // Don't fail if reaction fails - it's not critical
    core.warning(`Failed to add reaction to comment: ${error}`);
  }
}

// ============================================================================
// Status Comment Management
// ============================================================================

/**
 * Create a status comment indicating work has started
 * Returns the comment ID (string for discussions, numeric string for issues/PRs)
 */
export async function signalStart(
  ctx: SignalContext,
  progress?: ProgressInfo,
): Promise<string> {
  const description = JOB_DESCRIPTIONS[ctx.job] ?? ctx.job;

  // Build progress section for iterate jobs
  let progressSection = "";
  if (ctx.job === "issue-iterate" && progress) {
    const iteration = progress.iteration ?? 0;
    const failures = progress.consecutiveFailures ?? 0;
    const maxRetries = progress.maxRetries ?? 5;

    progressSection = `\n\n**Progress:**`;
    progressSection += `\n- Iteration: ${iteration}`;

    if (failures > 0) {
      progressSection += `\n- Retry attempt: ${failures}/${maxRetries}`;
    }
  }

  const body = `⏳ **nopo-bot** is ${description}...${progressSection}

[View workflow run](${ctx.runUrl})`;

  // Add eyes reaction to triggering comment if provided
  if (ctx.triggerCommentId) {
    await addReactionToComment(
      ctx.octokit,
      ctx.owner,
      ctx.repo,
      ctx.triggerCommentId,
      ctx.resourceType,
      "eyes",
    );
  }

  // Create status comment based on resource type
  if (ctx.resourceType === "discussion") {
    // Get discussion ID first
    const discussionResult = await ctx.octokit.graphql<DiscussionIdResponse>(
      GET_DISCUSSION_ID_QUERY,
      {
        owner: ctx.owner,
        repo: ctx.repo,
        number: ctx.resourceNumber,
      },
    );

    const discussionId = discussionResult.repository?.discussion?.id;
    if (!discussionId) {
      throw new Error(`Discussion #${ctx.resourceNumber} not found`);
    }

    // Create comment
    const commentResult = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      { discussionId, body },
    );

    const commentId = commentResult.addDiscussionComment?.comment?.id;
    if (!commentId) {
      throw new Error("Failed to create discussion comment");
    }

    core.info(`Created status comment: ${commentId}`);
    return commentId;
  }

  // For issues and PRs, use the issues API (PRs are issues in GitHub)
  const { data: comment } = await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.resourceNumber,
    body,
  });

  core.info(`Created status comment: ${comment.id}`);
  return String(comment.id);
}

/**
 * Update the status comment with the final result
 */
export async function signalEnd(
  ctx: SignalContext,
  statusCommentId: string,
  result: RunnerJobResult,
): Promise<void> {
  const description = JOB_DESCRIPTIONS[ctx.job] ?? ctx.job;

  let emoji: string;
  let status: string;
  let reaction: ReactionType;

  switch (result) {
    case "success":
      emoji = "✅";
      status = "completed successfully";
      reaction = "rocket";
      break;
    case "failure":
      emoji = "❌";
      status = "failed";
      reaction = "-1";
      break;
    case "cancelled":
      emoji = "⚠️";
      status = "was cancelled";
      reaction = "-1";
      break;
  }

  const body = `${emoji} **nopo-bot** ${description} ${status}.

[View workflow run](${ctx.runUrl})`;

  try {
    if (ctx.resourceType === "discussion") {
      // Use GraphQL for discussion comments
      await ctx.octokit.graphql(UPDATE_DISCUSSION_COMMENT_MUTATION, {
        commentId: statusCommentId,
        body,
      });
    } else {
      // Use REST API for issue/PR comments
      await ctx.octokit.rest.issues.updateComment({
        owner: ctx.owner,
        repo: ctx.repo,
        comment_id: parseInt(statusCommentId, 10),
        body,
      });
    }
    core.info(`Updated status comment ${statusCommentId} to ${result}`);
  } catch (error) {
    core.warning(`Failed to update status comment: ${error}`);
  }

  // Add reaction to status comment
  await addReactionToComment(
    ctx.octokit,
    ctx.owner,
    ctx.repo,
    statusCommentId,
    ctx.resourceType,
    reaction,
  );

  // Add reaction to triggering comment if provided
  if (ctx.triggerCommentId) {
    await addReactionToComment(
      ctx.octokit,
      ctx.owner,
      ctx.repo,
      ctx.triggerCommentId,
      ctx.resourceType,
      reaction,
    );
  }
}
