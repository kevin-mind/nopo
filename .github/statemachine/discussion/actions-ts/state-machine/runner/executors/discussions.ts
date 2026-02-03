import * as core from "@actions/core";
import type {
  AddDiscussionCommentAction,
  UpdateDiscussionBodyAction,
  AddDiscussionReactionAction,
  CreateIssuesFromDiscussionAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// GraphQL Queries and Mutations
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

const ADD_REACTION_MUTATION = `
mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
  addReaction(input: {
    subjectId: $subjectId
    content: $content
  }) {
    reaction {
      id
      content
    }
  }
}
`;

const GET_DISCUSSION_ID_QUERY = `
query GetDiscussionId($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
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

const ADD_LABELS_MUTATION = `
mutation AddLabelsToLabelable($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
    labelable {
      __typename
    }
  }
}
`;

const GET_LABEL_IDS_QUERY = `
query GetLabelIds($owner: String!, $repo: String!, $names: [String!]!) {
  repository(owner: $owner, name: $repo) {
    labels(first: 100, query: "") {
      nodes {
        id
        name
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

interface AddReactionResponse {
  addReaction?: {
    reaction?: {
      id?: string;
      content?: string;
    };
  };
}

interface DiscussionIdResponse {
  repository?: {
    discussion?: {
      id?: string;
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

// ============================================================================
// Discussion Executors
// ============================================================================

/**
 * Add a comment to a GitHub Discussion
 * Supports threading via replyToNodeId
 */
export async function executeAddDiscussionComment(
  action: AddDiscussionCommentAction,
  ctx: RunnerContext,
): Promise<{ commentId: string }> {
  let response: AddCommentResponse;

  if (action.replyToNodeId) {
    // Reply to an existing comment (thread)
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_REPLY_MUTATION,
      {
        discussionId: action.discussionNodeId,
        replyToId: action.replyToNodeId,
        body: action.body,
      },
    );
  } else {
    // Top-level comment
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      {
        discussionId: action.discussionNodeId,
        body: action.body,
      },
    );
  }

  const commentId = response.addDiscussionComment?.comment?.id;
  if (!commentId) {
    throw new Error("Failed to add discussion comment");
  }

  core.info(
    `Added ${action.replyToNodeId ? "reply" : "comment"} to discussion`,
  );
  return { commentId };
}

/**
 * Update the body of a GitHub Discussion
 * Used for maintaining the "living document" pattern
 */
export async function executeUpdateDiscussionBody(
  action: UpdateDiscussionBodyAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean }> {
  const response = await ctx.octokit.graphql<UpdateDiscussionResponse>(
    UPDATE_DISCUSSION_MUTATION,
    {
      discussionId: action.discussionNodeId,
      body: action.newBody,
    },
  );

  if (!response.updateDiscussion?.discussion?.id) {
    throw new Error("Failed to update discussion body");
  }

  core.info("Updated discussion body");
  return { updated: true };
}

/**
 * Add a reaction to a discussion or comment
 */
export async function executeAddDiscussionReaction(
  action: AddDiscussionReactionAction,
  ctx: RunnerContext,
): Promise<{ reactionId: string }> {
  const response = await ctx.octokit.graphql<AddReactionResponse>(
    ADD_REACTION_MUTATION,
    {
      subjectId: action.subjectId,
      content: action.content,
    },
  );

  const reactionId = response.addReaction?.reaction?.id;
  if (!reactionId) {
    throw new Error("Failed to add reaction");
  }

  core.info(`Added ${action.content} reaction`);
  return { reactionId };
}

/**
 * Create issues from a discussion (for /plan command)
 */
export async function executeCreateIssuesFromDiscussion(
  action: CreateIssuesFromDiscussionAction,
  ctx: RunnerContext,
): Promise<{ issueNumbers: number[] }> {
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

  // Get discussion ID for linking in issue body
  const discussionResponse = await ctx.octokit.graphql<DiscussionIdResponse>(
    GET_DISCUSSION_ID_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      number: action.discussionNumber,
    },
  );

  const discussionId = discussionResponse.repository?.discussion?.id;

  // Get all labels from the repo for mapping
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

  for (const issueDef of action.issues) {
    // Add discussion reference to issue body
    const bodyWithRef = discussionId
      ? `${issueDef.body}\n\n---\n*Created from discussion #${action.discussionNumber}*`
      : issueDef.body;

    // Create the issue
    const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
      CREATE_ISSUE_MUTATION,
      {
        repositoryId: repoId,
        title: issueDef.title,
        body: bodyWithRef,
      },
    );

    const issueId = createResponse.createIssue?.issue?.id;
    const issueNumber = createResponse.createIssue?.issue?.number;

    if (!issueId || !issueNumber) {
      throw new Error(`Failed to create issue: ${issueDef.title}`);
    }

    // Add labels if specified
    if (issueDef.labels.length > 0) {
      const labelIds = issueDef.labels
        .map((name) => labelMap.get(name.toLowerCase()))
        .filter((id): id is string => id !== undefined);

      if (labelIds.length > 0) {
        await ctx.octokit.graphql(ADD_LABELS_MUTATION, {
          labelableId: issueId,
          labelIds,
        });
      }
    }

    issueNumbers.push(issueNumber);
    core.info(`Created issue #${issueNumber}: ${issueDef.title}`);
  }

  return { issueNumbers };
}
