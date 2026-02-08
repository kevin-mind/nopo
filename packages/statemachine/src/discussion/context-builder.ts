/**
 * Discussion Context Builder
 *
 * Fetches discussion data from GitHub API and builds the context
 * needed for the discussion state machine.
 */

import * as core from "@actions/core";
import { GET_DISCUSSION_QUERY } from "@more/issue-state";
import type {
  DiscussionContext,
  Discussion,
  DiscussionCommand,
} from "../schemas/discussion-context.js";
import { createDiscussionContext } from "../schemas/discussion-context.js";
import type { DiscussionTriggerType } from "../schemas/discussion-triggers.js";

// ============================================================================
// Types
// ============================================================================

interface DiscussionQueryResponse {
  repository?: {
    discussion?: {
      id?: string;
      number?: number;
      title?: string;
      body?: string;
      comments?: {
        totalCount?: number;
        nodes?: Array<{
          id?: string;
          body?: string;
          author?: {
            login?: string;
          };
          replies?: {
            totalCount?: number;
          };
        }>;
      };
    };
  };
}

/**
 * Options for building discussion context
 */
export interface BuildDiscussionContextOptions {
  commentId?: string;
  commentBody?: string;
  commentAuthor?: string;
  command?: DiscussionCommand;
  maxRetries?: number;
  botUsername?: string;
}

/**
 * Octokit-compatible client interface
 * Works with @actions/github.getOctokit() or similar
 */
interface GitHubClient {
  graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
}

// ============================================================================
// Context Builder
// ============================================================================

/**
 * Build discussion context from GitHub API
 *
 * Fetches discussion data and builds the context needed for the state machine.
 *
 * @param octokit - GitHub API client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param discussionNumber - Discussion number
 * @param trigger - What triggered this run
 * @param options - Additional context options
 */
export async function buildDiscussionContext(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  discussionNumber: number,
  trigger: DiscussionTriggerType,
  options: BuildDiscussionContextOptions = {},
): Promise<DiscussionContext | null> {
  try {
    core.info(`Fetching discussion #${discussionNumber}`);

    const response = await octokit.graphql<DiscussionQueryResponse>(
      GET_DISCUSSION_QUERY,
      {
        owner,
        repo,
        number: discussionNumber,
      },
    );

    const discussionData = response.repository?.discussion;
    if (!discussionData || !discussionData.id) {
      core.error(`Discussion #${discussionNumber} not found`);
      return null;
    }

    // Extract research threads from comments
    // Research threads are top-level comments from the bot with a ## heading
    const researchThreads: Discussion["researchThreads"] = [];
    const botUsername = options.botUsername ?? "nopo-bot";

    for (const comment of discussionData.comments?.nodes ?? []) {
      if (!comment?.id || !comment?.body) continue;

      const author = comment.author?.login;
      const isBot =
        author === botUsername ||
        author === "claude[bot]" ||
        author?.endsWith("[bot]");

      // Check if this is a research thread (bot comment with ## heading)
      if (isBot && comment.body.startsWith("## ")) {
        const topicMatch = comment.body.match(/^## (.+?)(?:\n|$)/);
        const topic = topicMatch?.[1] ?? "Research";

        researchThreads.push({
          nodeId: comment.id,
          topic,
          replyCount: comment.replies?.totalCount ?? 0,
        });
      }
    }

    // Build discussion object
    const discussion: Discussion = {
      number: discussionData.number ?? discussionNumber,
      nodeId: discussionData.id,
      title: discussionData.title ?? "",
      body: discussionData.body ?? "",
      commentCount: discussionData.comments?.totalCount ?? 0,
      researchThreads,
      command: options.command,
      commentId: options.commentId,
      commentBody: options.commentBody,
      commentAuthor: options.commentAuthor,
    };

    core.info(`Discussion fetched: "${discussion.title}"`);
    core.info(`Comments: ${discussion.commentCount}`);
    core.info(`Research threads: ${researchThreads.length}`);

    return createDiscussionContext({
      trigger,
      owner,
      repo,
      discussion,
      maxRetries: options.maxRetries,
      botUsername: options.botUsername,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to build discussion context: ${errorMessage}`);
    return null;
  }
}
