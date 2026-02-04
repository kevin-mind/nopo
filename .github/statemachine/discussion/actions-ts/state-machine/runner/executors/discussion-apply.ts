import * as core from "@actions/core";
import type {
  ApplyDiscussionResearchOutputAction,
  ApplyDiscussionRespondOutputAction,
  ApplyDiscussionSummarizeOutputAction,
  ApplyDiscussionPlanOutputAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// GraphQL Mutations
// ============================================================================

const ADD_DISCUSSION_COMMENT_MUTATION = `
mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    body: $body
  }) {
    comment {
      id
      body
    }
  }
}
`;

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

const GET_REPO_ID_QUERY = `
query GetRepoId($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
  }
}
`;

const CREATE_ISSUE_MUTATION = `
mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String!) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
    issue {
      id
      number
    }
  }
}
`;

const GET_LABEL_IDS_QUERY = `
query GetLabelIds($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    labels(first: 100) {
      nodes {
        id
        name
      }
    }
  }
}
`;

const ADD_LABELS_MUTATION = `
mutation AddLabelsToLabelable($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
    labelable {
      __typename
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

interface RepoIdResponse {
  repository?: {
    id?: string;
  };
}

interface CreateIssueResponse {
  createIssue?: {
    issue?: {
      id?: string;
      number?: number;
    };
  };
}

interface LabelsResponse {
  repository?: {
    labels?: {
      nodes?: Array<{
        id?: string;
        name?: string;
      }>;
    };
  };
}

/**
 * Research thread from structured output
 * Note: Field names must match outputs.json schema
 */
interface ResearchThread {
  title: string;
  question: string;
  investigation_areas: string[];
  expected_deliverables: string[];
}

/**
 * Research output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionResearchOutput {
  threads: ResearchThread[];
  updated_body?: string;
  agent_notes?: string[];
}

/**
 * Respond output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionRespondOutput {
  response_body: string;
  updated_body?: string;
  agent_notes?: string[];
}

/**
 * Summarize output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionSummarizeOutput {
  summary_comment: string;
  updated_body: string;
  agent_notes?: string[];
}

/**
 * Issue definition for plan output
 */
interface PlannedIssue {
  title: string;
  body: string;
  labels?: string[];
}

/**
 * Plan output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionPlanOutput {
  issues: PlannedIssue[];
  updated_body: string;
  summary_comment: string;
  agent_notes?: string[];
}

// ============================================================================
// Executors
// ============================================================================

/**
 * Apply discussion research output
 *
 * Creates research thread comments from Claude's analysis.
 * Each thread becomes a top-level comment on the discussion.
 */
export async function executeApplyDiscussionResearchOutput(
  action: ApplyDiscussionResearchOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; threadIds: string[] }> {
  const { discussionNodeId } = action;

  if (!structuredOutput) {
    core.warning(
      "No structured output provided for applyDiscussionResearchOutput",
    );
    return { applied: false, threadIds: [] };
  }

  const output = structuredOutput as DiscussionResearchOutput;

  core.info(`Processing research output for discussion`);
  core.startGroup("Research Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would create ${output.threads?.length ?? 0} research threads`,
    );
    return { applied: true, threadIds: [] };
  }

  const threadIds: string[] = [];

  // Create research thread comments
  for (const thread of output.threads || []) {
    // Format the thread body from the schema fields
    const areas = thread.investigation_areas?.map((a) => `- ${a}`).join("\n") || "";
    const deliverables = thread.expected_deliverables?.map((d) => `- ${d}`).join("\n") || "";

    const body = `## 🔍 Research: ${thread.title}

**Question:** ${thread.question}

### Investigation Areas
${areas}

### Expected Deliverables
${deliverables}`;

    const response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      {
        discussionId: discussionNodeId,
        body,
      },
    );

    const commentId = response.addDiscussionComment?.comment?.id;
    if (commentId) {
      threadIds.push(commentId);
      core.info(`Created research thread: ${thread.title}`);
    }
  }

  // Update discussion body if provided
  if (output.updated_body) {
    await ctx.octokit.graphql<UpdateDiscussionResponse>(
      UPDATE_DISCUSSION_MUTATION,
      {
        discussionId: discussionNodeId,
        body: output.updated_body,
      },
    );
    core.info("Updated discussion body");
  }

  return { applied: true, threadIds };
}

/**
 * Apply discussion respond output
 *
 * Posts a response comment, optionally as a reply to a thread.
 */
export async function executeApplyDiscussionRespondOutput(
  action: ApplyDiscussionRespondOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; commentId?: string }> {
  const { discussionNodeId, replyToNodeId } = action;

  if (!structuredOutput) {
    core.warning(
      "No structured output provided for applyDiscussionRespondOutput",
    );
    return { applied: false };
  }

  const output = structuredOutput as DiscussionRespondOutput;

  core.info(`Processing respond output for discussion`);
  core.startGroup("Respond Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info("[DRY RUN] Would post response comment");
    return { applied: true };
  }

  let response: AddCommentResponse;

  if (replyToNodeId) {
    // Reply to existing comment (thread)
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_REPLY_MUTATION,
      {
        discussionId: discussionNodeId,
        replyToId: replyToNodeId,
        body: output.response_body,
      },
    );
  } else {
    // Top-level comment
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      {
        discussionId: discussionNodeId,
        body: output.response_body,
      },
    );
  }

  const commentId = response.addDiscussionComment?.comment?.id;
  core.info(`Posted ${replyToNodeId ? "reply" : "comment"} to discussion`);

  // Update discussion body if provided
  if (output.updated_body) {
    await ctx.octokit.graphql<UpdateDiscussionResponse>(
      UPDATE_DISCUSSION_MUTATION,
      {
        discussionId: discussionNodeId,
        body: output.updated_body,
      },
    );
    core.info("Updated discussion body");
  }

  return { applied: true, commentId };
}

/**
 * Apply discussion summarize output
 *
 * Updates the discussion body with a comprehensive summary.
 */
export async function executeApplyDiscussionSummarizeOutput(
  action: ApplyDiscussionSummarizeOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean }> {
  const { discussionNodeId } = action;

  if (!structuredOutput) {
    core.warning(
      "No structured output provided for applyDiscussionSummarizeOutput",
    );
    return { applied: false };
  }

  const output = structuredOutput as DiscussionSummarizeOutput;

  core.info(`Processing summarize output for discussion`);
  core.startGroup("Summarize Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info("[DRY RUN] Would update discussion body with summary");
    return { applied: true };
  }

  // Update discussion body with summary
  await ctx.octokit.graphql<UpdateDiscussionResponse>(
    UPDATE_DISCUSSION_MUTATION,
    {
      discussionId: discussionNodeId,
      body: output.updated_body,
    },
  );

  core.info("Updated discussion body with summary");

  // Post summary as a comment as well
  await ctx.octokit.graphql<AddCommentResponse>(
    ADD_DISCUSSION_COMMENT_MUTATION,
    {
      discussionId: discussionNodeId,
      body: `## Summary

${output.summary_comment}`,
    },
  );

  core.info("Posted summary comment");

  return { applied: true };
}

/**
 * Apply discussion plan output
 *
 * Creates issues from the plan and posts a summary comment.
 */
export async function executeApplyDiscussionPlanOutput(
  action: ApplyDiscussionPlanOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; issueNumbers: number[] }> {
  const { discussionNumber, discussionNodeId } = action;

  if (!structuredOutput) {
    core.warning("No structured output provided for applyDiscussionPlanOutput");
    return { applied: false, issueNumbers: [] };
  }

  const output = structuredOutput as DiscussionPlanOutput;

  core.info(`Processing plan output for discussion #${discussionNumber}`);
  core.startGroup("Plan Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would create ${output.issues?.length ?? 0} issues`);
    return { applied: true, issueNumbers: [] };
  }

  // Get repository ID
  const repoResponse = await ctx.octokit.graphql<RepoIdResponse>(
    GET_REPO_ID_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
    },
  );

  const repoId = repoResponse.repository?.id;
  if (!repoId) {
    throw new Error("Repository not found");
  }

  // Get label map
  const labelsResponse = await ctx.octokit.graphql<LabelsResponse>(
    GET_LABEL_IDS_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
    },
  );

  const labelMap = new Map<string, string>();
  for (const label of labelsResponse.repository?.labels?.nodes || []) {
    if (label.id && label.name) {
      labelMap.set(label.name.toLowerCase(), label.id);
    }
  }

  const issueNumbers: number[] = [];

  // Create issues
  for (const issue of output.issues || []) {
    const bodyWithRef = `${issue.body}

---
*Created from discussion #${discussionNumber}*`;

    const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
      CREATE_ISSUE_MUTATION,
      {
        repositoryId: repoId,
        title: issue.title,
        body: bodyWithRef,
      },
    );

    const issueId = createResponse.createIssue?.issue?.id;
    const issueNum = createResponse.createIssue?.issue?.number;

    if (!issueId || !issueNum) {
      core.warning(`Failed to create issue: ${issue.title}`);
      continue;
    }

    // Add labels if specified
    if (issue.labels && issue.labels.length > 0) {
      const labelIds = issue.labels
        .map((name) => labelMap.get(name.toLowerCase()))
        .filter((id): id is string => id !== undefined);

      if (labelIds.length > 0) {
        await ctx.octokit.graphql(ADD_LABELS_MUTATION, {
          labelableId: issueId,
          labelIds,
        });
      }
    }

    issueNumbers.push(issueNum);
    core.info(`Created issue #${issueNum}: ${issue.title}`);
  }

  // Post summary comment with links to created issues
  const issueLinks = issueNumbers.map((n) => `- #${n}`).join("\n");
  const summaryBody = `## Implementation Plan

${output.summary_comment}

### Created Issues

${issueLinks}`;

  await ctx.octokit.graphql<AddCommentResponse>(
    ADD_DISCUSSION_COMMENT_MUTATION,
    {
      discussionId: discussionNodeId,
      body: summaryBody,
    },
  );

  core.info(`Posted plan summary with ${issueNumbers.length} issue links`);

  return { applied: true, issueNumbers };
}
