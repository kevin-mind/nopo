import * as core from "@actions/core";
import type {
  CloseIssueAction,
  AppendHistoryAction,
  UpdateHistoryAction,
  UpdateIssueBodyAction,
  AddCommentAction,
  UnassignUserAction,
  CreatePRAction,
  ConvertPRToDraftAction,
  MarkPRReadyAction,
  RequestReviewAction,
  MergePRAction,
  CreateSubIssuesAction,
} from "../../schemas/index.js";
import { addHistoryEntry, updateHistoryEntry } from "../../parser/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// GraphQL Queries
// ============================================================================

const GET_ISSUE_BODY_QUERY = `
query GetIssueBody($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
      body
    }
  }
}
`;

const CONVERT_PR_TO_DRAFT_MUTATION = `
mutation ConvertPRToDraft($prId: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $prId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

const MARK_PR_READY_MUTATION = `
mutation MarkPRReady($prId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $prId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

const GET_PR_ID_QUERY = `
query GetPRId($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      id
    }
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

const ADD_SUB_ISSUE_MUTATION = `
mutation AddSubIssue($parentId: ID!, $childId: ID!) {
  addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
    issue {
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

// ============================================================================
// Types
// ============================================================================

interface IssueBodyResponse {
  repository?: {
    issue?: {
      id?: string;
      body?: string;
    };
  };
}

interface PRIdResponse {
  repository?: {
    pullRequest?: {
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

// ============================================================================
// Issue Executors
// ============================================================================

/**
 * Close an issue
 */
export async function executeCloseIssue(
  action: CloseIssueAction,
  ctx: RunnerContext,
): Promise<{ closed: boolean }> {
  await ctx.octokit.rest.issues.update({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    state: "closed",
    state_reason: action.reason === "not_planned" ? "not_planned" : "completed",
  });

  core.info(`Closed issue #${action.issueNumber}`);
  return { closed: true };
}

/**
 * Append to iteration history
 */
export async function executeAppendHistory(
  action: AppendHistoryAction,
  ctx: RunnerContext,
): Promise<{ appended: boolean }> {
  // Get current issue body
  const response = await ctx.octokit.graphql<IssueBodyResponse>(
    GET_ISSUE_BODY_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: action.issueNumber,
    },
  );

  const currentBody = response.repository?.issue?.body || "";

  // Get current iteration (we don't have it in the action, so we'll use 0 as default)
  // In a real implementation, this would come from the context
  const iteration = 0;

  const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;
  const newBody = addHistoryEntry(
    currentBody,
    iteration,
    action.phase,
    action.message,
    action.commitSha,
    action.runLink,
    repoUrl,
  );

  await ctx.octokit.rest.issues.update({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    body: newBody,
  });

  core.info(`Appended history: Phase ${action.phase}, ${action.message}`);
  return { appended: true };
}

/**
 * Update an existing history entry
 */
export async function executeUpdateHistory(
  action: UpdateHistoryAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean }> {
  // Get current issue body
  const response = await ctx.octokit.graphql<IssueBodyResponse>(
    GET_ISSUE_BODY_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: action.issueNumber,
    },
  );

  const currentBody = response.repository?.issue?.body || "";
  const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;

  const result = updateHistoryEntry(
    currentBody,
    action.matchIteration,
    action.matchPhase,
    action.matchPattern,
    action.newMessage,
    action.commitSha,
    action.runLink,
    repoUrl,
  );

  if (result.updated) {
    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: action.issueNumber,
      body: result.body,
    });

    core.info(`Updated history: Phase ${action.matchPhase}, ${action.newMessage}`);
  } else {
    core.info(`No matching history entry found to update`);
  }

  return { updated: result.updated };
}

/**
 * Update issue body
 */
export async function executeUpdateIssueBody(
  action: UpdateIssueBodyAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean }> {
  await ctx.octokit.rest.issues.update({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    body: action.body,
  });

  core.info(`Updated body for issue #${action.issueNumber}`);
  return { updated: true };
}

/**
 * Add a comment to an issue
 */
export async function executeAddComment(
  action: AddCommentAction,
  ctx: RunnerContext,
): Promise<{ commentId: number }> {
  const response = await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    body: action.body,
  });

  core.info(`Added comment to issue #${action.issueNumber}`);
  return { commentId: response.data.id };
}

/**
 * Unassign a user from an issue
 */
export async function executeUnassignUser(
  action: UnassignUserAction,
  ctx: RunnerContext,
): Promise<{ unassigned: boolean }> {
  await ctx.octokit.rest.issues.removeAssignees({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    assignees: [action.username],
  });

  core.info(`Unassigned ${action.username} from issue #${action.issueNumber}`);
  return { unassigned: true };
}

/**
 * Create sub-issues for phased work
 */
export async function executeCreateSubIssues(
  action: CreateSubIssuesAction,
  ctx: RunnerContext,
): Promise<{ subIssueNumbers: number[] }> {
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

  // Get parent issue ID
  const parentResponse = await ctx.octokit.graphql<IssueBodyResponse>(
    GET_ISSUE_BODY_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: action.parentIssueNumber,
    },
  );

  const parentId = parentResponse.repository?.issue?.id;
  if (!parentId) {
    throw new Error(`Parent issue #${action.parentIssueNumber} not found`);
  }

  const subIssueNumbers: number[] = [];

  for (let i = 0; i < action.phases.length; i++) {
    const phase = action.phases[i];
    if (!phase) continue;

    const title = `[Phase ${i + 1}]: ${phase.title}`;

    // Create the sub-issue
    const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
      CREATE_ISSUE_MUTATION,
      {
        repositoryId: repoId,
        title,
        body: phase.body,
      },
    );

    const issueId = createResponse.createIssue?.issue?.id;
    const issueNumber = createResponse.createIssue?.issue?.number;

    if (!issueId || !issueNumber) {
      throw new Error(`Failed to create sub-issue for phase ${i + 1}`);
    }

    // Link as sub-issue
    await ctx.octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
      parentId,
      childId: issueId,
    });

    subIssueNumbers.push(issueNumber);
    core.info(`Created sub-issue #${issueNumber} for phase ${i + 1}`);
  }

  return { subIssueNumbers };
}

// ============================================================================
// PR Executors
// ============================================================================

/**
 * Create a pull request
 */
export async function executeCreatePR(
  action: CreatePRAction,
  ctx: RunnerContext,
): Promise<{ prNumber: number }> {
  const body = `${action.body}\n\nFixes #${action.issueNumber}`;

  const response = await ctx.octokit.rest.pulls.create({
    owner: ctx.owner,
    repo: ctx.repo,
    title: action.title,
    body,
    head: action.branchName,
    base: action.baseBranch,
    draft: action.draft,
  });

  core.info(`Created PR #${response.data.number} for issue #${action.issueNumber}`);
  return { prNumber: response.data.number };
}

/**
 * Convert PR to draft
 */
export async function executeConvertPRToDraft(
  action: ConvertPRToDraftAction,
  ctx: RunnerContext,
): Promise<{ converted: boolean }> {
  // Get PR node ID
  const prResponse = await ctx.octokit.graphql<PRIdResponse>(GET_PR_ID_QUERY, {
    owner: ctx.owner,
    repo: ctx.repo,
    prNumber: action.prNumber,
  });

  const prId = prResponse.repository?.pullRequest?.id;
  if (!prId) {
    throw new Error(`PR #${action.prNumber} not found`);
  }

  await ctx.octokit.graphql(CONVERT_PR_TO_DRAFT_MUTATION, { prId });

  core.info(`Converted PR #${action.prNumber} to draft`);
  return { converted: true };
}

/**
 * Mark PR as ready for review
 */
export async function executeMarkPRReady(
  action: MarkPRReadyAction,
  ctx: RunnerContext,
): Promise<{ ready: boolean }> {
  // Get PR node ID
  const prResponse = await ctx.octokit.graphql<PRIdResponse>(GET_PR_ID_QUERY, {
    owner: ctx.owner,
    repo: ctx.repo,
    prNumber: action.prNumber,
  });

  const prId = prResponse.repository?.pullRequest?.id;
  if (!prId) {
    throw new Error(`PR #${action.prNumber} not found`);
  }

  await ctx.octokit.graphql(MARK_PR_READY_MUTATION, { prId });

  core.info(`Marked PR #${action.prNumber} as ready for review`);
  return { ready: true };
}

/**
 * Request a reviewer
 */
export async function executeRequestReview(
  action: RequestReviewAction,
  ctx: RunnerContext,
): Promise<{ requested: boolean }> {
  await ctx.octokit.rest.pulls.requestReviewers({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: action.prNumber,
    reviewers: [action.reviewer],
  });

  core.info(`Requested review from ${action.reviewer} on PR #${action.prNumber}`);
  return { requested: true };
}

/**
 * Merge a PR
 */
export async function executeMergePR(
  action: MergePRAction,
  ctx: RunnerContext,
): Promise<{ merged: boolean; sha: string }> {
  const response = await ctx.octokit.rest.pulls.merge({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: action.prNumber,
    merge_method: action.mergeMethod,
  });

  core.info(`Merged PR #${action.prNumber}`);
  return { merged: response.data.merged, sha: response.data.sha };
}
