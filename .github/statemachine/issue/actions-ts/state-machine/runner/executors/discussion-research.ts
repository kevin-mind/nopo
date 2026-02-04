import * as core from "@actions/core";
import type {
  InvestigateResearchThreadsAction,
  UpdateDiscussionSummaryAction,
  ResearchThread,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { executeRunClaude } from "./claude.js";

// ============================================================================
// GraphQL Mutations
// ============================================================================

const ADD_DISCUSSION_REPLY_MUTATION = `
mutation AddDiscussionReply($discussionId: ID!, $replyToId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    replyToId: $replyToId
    body: $body
  }) {
    comment {
      id
      body
    }
  }
}
`;

const UPDATE_DISCUSSION_MUTATION = `
mutation UpdateDiscussion($discussionId: ID!, $body: String!) {
  updateDiscussion(input: {
    discussionId: $discussionId
    body: $body
  }) {
    discussion {
      id
      body
    }
  }
}
`;

const GET_DISCUSSION_COMMENTS_QUERY = `
query GetDiscussionComments($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      body
      comments(first: 100) {
        nodes {
          id
          author { login }
          body
          createdAt
          replies(first: 50) {
            nodes {
              id
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}
`;

// ============================================================================
// Types
// ============================================================================

interface AddCommentResponse {
  addDiscussionComment?: {
    comment?: {
      id?: string;
      body?: string;
    };
  };
}

interface UpdateDiscussionResponse {
  updateDiscussion?: {
    discussion?: {
      id?: string;
      body?: string;
    };
  };
}

interface DiscussionComment {
  id: string;
  author: { login: string };
  body: string;
  createdAt: string;
  replies: {
    nodes: Array<{
      id: string;
      author: { login: string };
      body: string;
      createdAt: string;
    }>;
  };
}

interface GetDiscussionCommentsResponse {
  repository?: {
    discussion?: {
      body?: string;
      comments?: {
        nodes?: DiscussionComment[];
      };
    };
  };
}

/**
 * Output from a single thread investigation
 */
interface ThreadInvestigationOutput {
  findings: string;
  key_points: string[];
  open_questions?: string[];
  recommendations?: string[];
  agent_notes?: string[];
}

/**
 * Output from the summary agent
 */
interface DiscussionSummaryOutput {
  updated_body: string;
  agent_notes?: string[];
}

// ============================================================================
// Executors
// ============================================================================

/**
 * Investigate research threads in parallel
 *
 * Similar to grooming - runs investigation agents for each thread concurrently,
 * collects their outputs, and posts findings as replies to each thread.
 */
export async function executeInvestigateResearchThreads(
  action: InvestigateResearchThreadsAction,
  ctx: RunnerContext,
): Promise<{ investigated: boolean; replyIds: string[] }> {
  const { discussionNumber, discussionNodeId, threads, promptVars } = action;

  core.info(
    `Investigating ${threads.length} research threads for discussion #${discussionNumber}`,
  );

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would investigate ${threads.length} research threads in parallel`,
    );
    return { investigated: true, replyIds: [] };
  }

  if (!threads || threads.length === 0) {
    core.warning("No research threads to investigate");
    return { investigated: false, replyIds: [] };
  }

  // Run all thread investigations in parallel
  const results = await Promise.all(
    threads.map(async (thread) => {
      core.info(`Starting investigation: ${thread.title}`);
      try {
        const result = await investigateThread(
          thread,
          discussionNumber,
          discussionNodeId,
          promptVars || {},
          ctx,
        );
        core.info(`Investigation completed: ${thread.title}`);
        return result;
      } catch (error) {
        core.warning(`Investigation failed for "${thread.title}": ${error}`);
        // Post error as reply
        const errorReplyId = await postInvestigationError(
          thread,
          discussionNodeId,
          error,
          ctx,
        );
        return { thread, replyId: errorReplyId, success: false };
      }
    }),
  );

  const replyIds = results
    .filter((r) => r.replyId)
    .map((r) => r.replyId as string);

  core.info(
    `Posted ${replyIds.length} investigation replies out of ${threads.length} threads`,
  );

  return { investigated: true, replyIds };
}

/**
 * Investigate a single research thread
 */
async function investigateThread(
  thread: ResearchThread,
  discussionNumber: number,
  discussionNodeId: string,
  basePromptVars: Record<string, string>,
  ctx: RunnerContext,
): Promise<{ thread: ResearchThread; replyId?: string; success: boolean }> {
  // Build prompt variables for this specific thread
  const threadPromptVars: Record<string, string> = {
    ...basePromptVars,
    THREAD_TITLE: thread.title,
    THREAD_QUESTION: thread.question,
    INVESTIGATION_AREAS: thread.investigationAreas.join("\n- "),
    EXPECTED_DELIVERABLES: thread.expectedDeliverables.join("\n- "),
  };

  // Run Claude investigation
  const result = await executeRunClaude(
    {
      type: "runClaude",
      token: "code",
      promptDir: "discussion/investigate",
      promptsDir: ".github/statemachine/discussion/prompts",
      promptVars: threadPromptVars,
      issueNumber: discussionNumber,
      worktree: "main",
    },
    ctx,
  );

  const output = result.structuredOutput as ThreadInvestigationOutput | undefined;

  if (!output || !output.findings) {
    throw new Error("Investigation did not return findings");
  }

  // Format and post the findings as a reply
  const replyBody = formatInvestigationFindings(thread, output);

  const response = await ctx.octokit.graphql<AddCommentResponse>(
    ADD_DISCUSSION_REPLY_MUTATION,
    {
      discussionId: discussionNodeId,
      replyToId: thread.commentNodeId,
      body: replyBody,
    },
  );

  const replyId = response.addDiscussionComment?.comment?.id;
  return { thread, replyId, success: true };
}

/**
 * Format investigation findings for posting
 */
function formatInvestigationFindings(
  thread: ResearchThread,
  output: ThreadInvestigationOutput,
): string {
  let body = `## 📊 Findings: ${thread.title}

${output.findings}

### Key Points
${output.key_points.map((p) => `- ${p}`).join("\n")}`;

  if (output.recommendations && output.recommendations.length > 0) {
    body += `

### Recommendations
${output.recommendations.map((r) => `- ${r}`).join("\n")}`;
  }

  if (output.open_questions && output.open_questions.length > 0) {
    body += `

### Open Questions
${output.open_questions.map((q) => `- ${q}`).join("\n")}`;
  }

  return body;
}

/**
 * Post an error message when investigation fails
 */
async function postInvestigationError(
  thread: ResearchThread,
  discussionNodeId: string,
  error: unknown,
  ctx: RunnerContext,
): Promise<string | undefined> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  const body = `## ⚠️ Investigation Error: ${thread.title}

Unable to complete investigation for this research thread.

**Error:** ${errorMessage}

Please retry or investigate manually.`;

  try {
    const response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_REPLY_MUTATION,
      {
        discussionId: discussionNodeId,
        replyToId: thread.commentNodeId,
        body,
      },
    );
    return response.addDiscussionComment?.comment?.id;
  } catch (postError) {
    core.warning(`Failed to post error reply: ${postError}`);
    return undefined;
  }
}

/**
 * Update discussion body with current state summary
 *
 * Reads all threads and comments, generates a comprehensive summary,
 * and updates the discussion body. Should be called at the end of
 * every discussion workflow to keep the body in sync.
 */
export async function executeUpdateDiscussionSummary(
  action: UpdateDiscussionSummaryAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean }> {
  const { discussionNumber, discussionNodeId, promptVars } = action;

  core.info(`Updating summary for discussion #${discussionNumber}`);

  if (ctx.dryRun) {
    core.info("[DRY RUN] Would update discussion body with summary");
    return { updated: true };
  }

  // Fetch current discussion state
  const discussionState = await fetchDiscussionState(discussionNumber, ctx);

  if (!discussionState) {
    core.warning("Could not fetch discussion state");
    return { updated: false };
  }

  // Build prompt variables with full discussion context
  const summaryPromptVars: Record<string, string> = {
    ...promptVars,
    ORIGINAL_BODY: discussionState.originalBody,
    DISCUSSION_STATE: JSON.stringify(discussionState.threads, null, 2),
  };

  // Run summary agent
  const result = await executeRunClaude(
    {
      type: "runClaude",
      token: "code",
      promptDir: "discussion/summarize",
      promptsDir: ".github/statemachine/discussion/prompts",
      promptVars: summaryPromptVars,
      issueNumber: discussionNumber,
      worktree: "main",
    },
    ctx,
  );

  const output = result.structuredOutput as DiscussionSummaryOutput | undefined;

  if (!output || !output.updated_body) {
    core.warning("Summary agent did not return updated_body");
    return { updated: false };
  }

  // Update the discussion body
  await ctx.octokit.graphql<UpdateDiscussionResponse>(
    UPDATE_DISCUSSION_MUTATION,
    {
      discussionId: discussionNodeId,
      body: output.updated_body,
    },
  );

  core.info("Updated discussion body with summary");
  return { updated: true };
}

/**
 * Fetch current discussion state for summarization
 */
async function fetchDiscussionState(
  discussionNumber: number,
  ctx: RunnerContext,
): Promise<{
  originalBody: string;
  threads: Array<{
    title: string;
    body: string;
    replies: Array<{ author: string; body: string }>;
  }>;
} | null> {
  try {
    const response = await ctx.octokit.graphql<GetDiscussionCommentsResponse>(
      GET_DISCUSSION_COMMENTS_QUERY,
      {
        owner: ctx.owner,
        repo: ctx.repo,
        number: discussionNumber,
      },
    );

    const discussion = response.repository?.discussion;
    if (!discussion) {
      return null;
    }

    const threads = (discussion.comments?.nodes || [])
      .filter((c) => c.body.startsWith("## 🔍 Research:"))
      .map((c) => ({
        title: c.body.split("\n")[0].replace("## 🔍 Research: ", ""),
        body: c.body,
        replies: c.replies.nodes.map((r) => ({
          author: r.author.login,
          body: r.body,
        })),
      }));

    return {
      originalBody: discussion.body || "",
      threads,
    };
  } catch (error) {
    core.warning(`Failed to fetch discussion state: ${error}`);
    return null;
  }
}
