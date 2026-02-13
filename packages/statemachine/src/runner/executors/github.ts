/**
 * GitHub Executors
 *
 * Executors for GitHub API operations (issues, PRs, labels, reviews).
 */

import * as core from "@actions/core";
import {
  GET_PR_ID_QUERY,
  GET_REPO_ID_QUERY,
  CONVERT_PR_TO_DRAFT_MUTATION,
  MARK_PR_READY_MUTATION,
  CREATE_ISSUE_MUTATION,
  ADD_SUB_ISSUE_MUTATION,
  parseIssue,
  createComment,
  parseMarkdown,
  type OctokitLike,
} from "@more/issue-state";
import type {
  CloseIssueAction,
  AppendHistoryAction,
  UpdateHistoryAction,
  UpdateIssueBodyAction,
  AddCommentAction,
  UnassignUserAction,
  AssignUserAction,
  CreatePRAction,
  ConvertPRToDraftAction,
  MarkPRReadyAction,
  RequestReviewAction,
  MergePRAction,
  SubmitReviewAction,
  RemoveReviewerAction,
  CreateSubIssuesAction,
  ResetIssueAction,
  AddLabelAction,
  RemoveLabelAction,
} from "../../schemas/index.js";
import {
  addHistoryEntry,
  updateHistoryEntry,
  replaceBody,
} from "../../parser/index.js";
import type { RunnerContext } from "../types.js";

// ============================================================================
// Types
// ============================================================================

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

// Helper to cast RunnerContext octokit to OctokitLike

function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
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
  const { data, update } = await parseIssue(
    ctx.owner,
    ctx.repo,
    action.issueNumber,
    {
      octokit: asOctokitLike(ctx),
      projectNumber: ctx.projectNumber,
      fetchPRs: false,
      fetchParent: false,
    },
  );

  const state = {
    ...data,
    issue: {
      ...data.issue,
      state: "CLOSED" as const,
      stateReason:
        action.reason === "not_planned"
          ? ("not_planned" as const)
          : ("completed" as const),
    },
  };

  await update(state);

  core.info(`Closed issue #${action.issueNumber}`);
  return { closed: true };
}

/**
 * Append to iteration history
 * If the issue is a sub-issue (has a parent), logs to both the issue and its parent
 */
export async function executeAppendHistory(
  action: AppendHistoryAction,
  ctx: RunnerContext,
): Promise<{ appended: boolean }> {
  const octokit = asOctokitLike(ctx);
  const iteration = action.iteration ?? 0;
  const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;
  const timestamp = action.timestamp || new Date().toISOString();

  // Update the issue
  const { data, update } = await parseIssue(
    ctx.owner,
    ctx.repo,
    action.issueNumber,
    {
      octokit,
      projectNumber: ctx.projectNumber,
      fetchPRs: false,
      fetchParent: false,
    },
  );

  const state = addHistoryEntry(
    {
      iteration,
      phase: action.phase,
      action: action.message,
      timestamp,
      sha: action.commitSha ?? null,
      runLink: action.runLink ?? null,
      repoUrl,
    },
    data,
  );

  await update(state);
  core.info(`Appended history: Phase ${action.phase}, ${action.message}`);

  // If this is a sub-issue, also log to parent
  if (data.issue.parentIssueNumber) {
    const { data: parentData, update: parentUpdate } = await parseIssue(
      ctx.owner,
      ctx.repo,
      data.issue.parentIssueNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    const parentState = addHistoryEntry(
      {
        iteration,
        phase: action.phase,
        action: action.message,
        timestamp,
        sha: action.commitSha ?? null,
        runLink: action.runLink ?? null,
        repoUrl,
      },
      parentData,
    );

    await parentUpdate(parentState);
    core.info(`Also appended to parent issue #${data.issue.parentIssueNumber}`);
  }

  return { appended: true };
}

/**
 * Update an existing history entry
 * If the issue is a sub-issue (has a parent), updates both the issue and its parent
 */
export async function executeUpdateHistory(
  action: UpdateHistoryAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean }> {
  const octokit = asOctokitLike(ctx);
  const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;
  const timestamp = action.timestamp || new Date().toISOString();

  const { data, update } = await parseIssue(
    ctx.owner,
    ctx.repo,
    action.issueNumber,
    {
      octokit,
      projectNumber: ctx.projectNumber,
      fetchPRs: false,
      fetchParent: false,
    },
  );

  // Try to update existing entry
  let state = updateHistoryEntry(
    {
      matchIteration: action.matchIteration,
      matchPhase: action.matchPhase,
      matchPattern: action.matchPattern,
      newAction: action.newMessage,
      timestamp,
      sha: action.commitSha ?? null,
      runLink: action.runLink ?? null,
      repoUrl,
    },
    data,
  );

  // If no change (no matching entry found), add a new entry
  if (state === data) {
    core.info(
      `No matching history entry found - adding new entry for Phase ${action.matchPhase}`,
    );
    state = addHistoryEntry(
      {
        iteration: action.matchIteration,
        phase: action.matchPhase,
        action: action.newMessage,
        timestamp,
        sha: action.commitSha ?? null,
        runLink: action.runLink ?? null,
        repoUrl,
      },
      data,
    );
  } else {
    core.info(
      `Updated history: Phase ${action.matchPhase}, ${action.newMessage}`,
    );
  }

  await update(state);

  // If this is a sub-issue, also update parent
  if (data.issue.parentIssueNumber) {
    const { data: parentData, update: parentUpdate } = await parseIssue(
      ctx.owner,
      ctx.repo,
      data.issue.parentIssueNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    let parentState = updateHistoryEntry(
      {
        matchIteration: action.matchIteration,
        matchPhase: action.matchPhase,
        matchPattern: action.matchPattern,
        newAction: action.newMessage,
        timestamp,
        sha: action.commitSha ?? null,
        runLink: action.runLink ?? null,
        repoUrl,
      },
      parentData,
    );

    if (parentState === parentData) {
      parentState = addHistoryEntry(
        {
          iteration: action.matchIteration,
          phase: action.matchPhase,
          action: action.newMessage,
          timestamp,
          sha: action.commitSha ?? null,
          runLink: action.runLink ?? null,
          repoUrl,
        },
        parentData,
      );
      core.info(
        `Added new entry to parent issue #${data.issue.parentIssueNumber}`,
      );
    } else {
      core.info(`Also updated parent issue #${data.issue.parentIssueNumber}`);
    }

    await parentUpdate(parentState);
  }

  return { updated: true };
}

/**
 * Update issue body
 */
export async function executeUpdateIssueBody(
  action: UpdateIssueBodyAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean }> {
  const octokit = asOctokitLike(ctx);

  const { data, update } = await parseIssue(
    ctx.owner,
    ctx.repo,
    action.issueNumber,
    {
      octokit,
      projectNumber: ctx.projectNumber,
      fetchPRs: false,
      fetchParent: false,
    },
  );

  const newBodyAst = parseMarkdown(action.body);
  const state = replaceBody({ bodyAst: newBodyAst }, data);
  await update(state);

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
  const result = await createComment(
    ctx.owner,
    ctx.repo,
    action.issueNumber,
    action.body,
    asOctokitLike(ctx),
  );

  core.info(`Added comment to issue #${action.issueNumber}`);
  return { commentId: result.commentId };
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
 * Assign a user to an issue
 * Used by orchestration to trigger iteration workflows on sub-issues
 */
export async function executeAssignUser(
  action: AssignUserAction,
  ctx: RunnerContext,
): Promise<{ assigned: boolean }> {
  await ctx.octokit.rest.issues.addAssignees({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    assignees: [action.username],
  });

  core.info(`Assigned ${action.username} to issue #${action.issueNumber}`);
  return { assigned: true };
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
  const parentQuery = `
    query GetParentIssueId($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          id
        }
      }
    }
  `;

  const parentResponse = await ctx.octokit.graphql<{
    repository: { issue: { id: string } | null };
  }>(parentQuery, {
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: action.parentIssueNumber,
  });

  const parentId = parentResponse.repository?.issue?.id;
  if (!parentId) {
    throw new Error(`Parent issue #${action.parentIssueNumber} not found`);
  }

  const subIssueNumbers: number[] = [];
  const octokit = asOctokitLike(ctx);

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

    // Add "triaged" label via parseIssue + update
    const { data: subData, update: subUpdate } = await parseIssue(
      ctx.owner,
      ctx.repo,
      issueNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    await subUpdate({
      ...subData,
      issue: {
        ...subData.issue,
        labels: [...subData.issue.labels, "triaged"],
      },
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
 * Create a pull request (or find existing one for branch)
 */
export async function executeCreatePR(
  action: CreatePRAction,
  ctx: RunnerContext,
): Promise<{ prNumber: number }> {
  // First check if a PR already exists for this branch
  const existingPRs = await ctx.octokit.rest.pulls.list({
    owner: ctx.owner,
    repo: ctx.repo,
    head: `${ctx.owner}:${action.branchName}`,
    base: action.baseBranch,
    state: "open",
  });

  const existingPR = existingPRs.data[0];
  if (existingPR) {
    core.info(
      `PR #${existingPR.number} already exists for branch ${action.branchName}`,
    );
    return { prNumber: existingPR.number };
  }

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

  core.info(
    `Created PR #${response.data.number} for issue #${action.issueNumber}`,
  );
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
  // Dismiss existing reviews from this reviewer so requestReviewers
  // fires the review_requested event (GitHub silently skips re-requesting
  // reviewers who already submitted a review on the current HEAD).
  const { data: reviews } = await ctx.octokit.rest.pulls.listReviews({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: action.prNumber,
  });

  const existingReviews = reviews.filter(
    (r) => r.user?.login === action.reviewer && r.state !== "DISMISSED",
  );

  for (const review of existingReviews) {
    await ctx.octokit.graphql(
      `mutation($reviewId: ID!, $message: String!) {
        dismissPullRequestReview(input: {
          pullRequestReviewId: $reviewId
          message: $message
        }) {
          pullRequestReview { id }
        }
      }`,
      {
        reviewId: review.node_id,
        message: "Dismissing for re-review after new iteration",
      },
    );
    core.info(
      `Dismissed ${review.state} review ${review.id} from ${action.reviewer} on PR #${action.prNumber}`,
    );
  }

  // Remove the reviewer from the requested list first, then re-add.
  // If the reviewer is already in requested_reviewers, calling
  // requestReviewers is a no-op and won't fire the review_requested event.
  try {
    await ctx.octokit.rest.pulls.removeRequestedReviewers({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: action.prNumber,
      reviewers: [action.reviewer],
    });
    core.info(
      `Removed ${action.reviewer} from requested reviewers on PR #${action.prNumber}`,
    );
  } catch {
    // Reviewer may not be in the requested list - that's fine
  }

  await ctx.octokit.rest.pulls.requestReviewers({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: action.prNumber,
    reviewers: [action.reviewer],
  });

  core.info(
    `Requested review from ${action.reviewer} on PR #${action.prNumber}`,
  );
  return { requested: true };
}

/**
 * Mark a PR as ready for merge
 *
 * This does NOT actually merge the PR - merging is a human action.
 * Instead, it:
 * 1. Adds a "ready-to-merge" label to the PR
 * 2. Adds an iteration history entry indicating readiness
 *
 * The E2E test runner has its own logic to simulate the human merge action.
 */
export async function executeMergePR(
  action: MergePRAction,
  ctx: RunnerContext,
): Promise<{ markedReady: boolean }> {
  const octokit = asOctokitLike(ctx);
  const label = "ready-to-merge";

  // Add "ready-to-merge" label to the PR via parseIssue
  try {
    const { data: prData, update: prUpdate } = await parseIssue(
      ctx.owner,
      ctx.repo,
      action.prNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    await prUpdate({
      ...prData,
      issue: {
        ...prData.issue,
        labels: [...prData.issue.labels, label],
      },
    });
    core.info(`Added "${label}" label to PR #${action.prNumber}`);
  } catch (error) {
    core.warning(`Failed to add label: ${error}`);
  }

  // Add history entry indicating PR is ready for merge
  const { data, update } = await parseIssue(
    ctx.owner,
    ctx.repo,
    action.issueNumber,
    {
      octokit,
      projectNumber: ctx.projectNumber,
      fetchPRs: false,
      fetchParent: false,
    },
  );

  const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;
  const timestamp = new Date().toISOString();
  const runLink = ctx.runUrl;

  const state = addHistoryEntry(
    {
      iteration: 0,
      phase: "-",
      action: "🔀 Ready for merge",
      timestamp,
      runLink: runLink ?? null,
      repoUrl,
    },
    data,
  );

  await update(state);

  core.info(
    `PR #${action.prNumber} marked ready for merge (human action required)`,
  );
  return { markedReady: true };
}

/**
 * Submit a PR review
 *
 * Uses the GitHub REST API to submit a PR review with the specified
 * decision (approve, request_changes, or comment).
 */
export async function executeSubmitReview(
  action: SubmitReviewAction,
  ctx: RunnerContext,
): Promise<{ submitted: boolean; decision: string }> {
  // Map our decision to GitHub's event type
  const eventMap: Record<string, "APPROVE" | "REQUEST_CHANGES" | "COMMENT"> = {
    approve: "APPROVE",
    request_changes: "REQUEST_CHANGES",
    comment: "COMMENT",
  };

  const event = eventMap[action.decision];
  if (!event) {
    throw new Error(`Invalid review decision: ${action.decision}`);
  }

  await ctx.octokit.rest.pulls.createReview({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: action.prNumber,
    event,
    body: action.body,
  });

  core.info(`Submitted ${action.decision} review on PR #${action.prNumber}`);
  return { submitted: true, decision: action.decision };
}

/**
 * Remove a reviewer from a PR
 * Used when converting PR to draft to clear stale review requests
 */
export async function executeRemoveReviewer(
  action: RemoveReviewerAction,
  ctx: RunnerContext,
): Promise<{ removed: boolean }> {
  try {
    await ctx.octokit.rest.pulls.removeRequestedReviewers({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: action.prNumber,
      reviewers: [action.reviewer],
    });

    core.info(
      `Removed reviewer ${action.reviewer} from PR #${action.prNumber}`,
    );
    return { removed: true };
  } catch (error) {
    // Don't fail if reviewer wasn't requested (404 error)
    if (error instanceof Error && error.message.includes("404")) {
      core.info(
        `Reviewer ${action.reviewer} was not a requested reviewer on PR #${action.prNumber}`,
      );
      return { removed: false };
    }
    throw error;
  }
}

/**
 * Reset an issue (and sub-issues) to initial state
 * - Reopens closed issues
 * - Sets parent status to Backlog
 * - Sets sub-issue statuses to Ready
 * - Clears iteration and failure counters
 * - Unassigns bot
 */
export async function executeResetIssue(
  action: ResetIssueAction,
  ctx: RunnerContext,
): Promise<{ resetCount: number }> {
  let resetCount = 0;
  const octokit = asOctokitLike(ctx);

  // 1. Reopen the parent issue if closed
  try {
    const { data, update } = await parseIssue(
      ctx.owner,
      ctx.repo,
      action.issueNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    if (data.issue.state === "CLOSED") {
      await update({
        ...data,
        issue: { ...data.issue, state: "OPEN" },
      });
      core.info(`Reopened issue #${action.issueNumber}`);
      resetCount++;
    }
  } catch (error) {
    core.warning(`Failed to reopen issue #${action.issueNumber}: ${error}`);
  }

  // 2. Reopen all sub-issues if closed
  for (const subIssueNumber of action.subIssueNumbers) {
    try {
      const { data: subData, update: subUpdate } = await parseIssue(
        ctx.owner,
        ctx.repo,
        subIssueNumber,
        {
          octokit,
          projectNumber: ctx.projectNumber,
          fetchPRs: false,
          fetchParent: false,
        },
      );

      if (subData.issue.state === "CLOSED") {
        await subUpdate({
          ...subData,
          issue: { ...subData.issue, state: "OPEN" },
        });
        core.info(`Reopened sub-issue #${subIssueNumber}`);
        resetCount++;
      }
    } catch (error) {
      core.warning(`Failed to reopen sub-issue #${subIssueNumber}: ${error}`);
    }
  }

  // 3. Unassign bot from parent issue
  try {
    const { data, update } = await parseIssue(
      ctx.owner,
      ctx.repo,
      action.issueNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    await update({
      ...data,
      issue: {
        ...data.issue,
        assignees: data.issue.assignees.filter((a) => a !== action.botUsername),
      },
    });
    core.info(
      `Unassigned ${action.botUsername} from issue #${action.issueNumber}`,
    );
  } catch (error) {
    core.warning(
      `Failed to unassign bot from issue #${action.issueNumber}: ${error}`,
    );
  }

  // 4. Unassign bot from all sub-issues
  for (const subIssueNumber of action.subIssueNumbers) {
    try {
      const { data: subData, update: subUpdate } = await parseIssue(
        ctx.owner,
        ctx.repo,
        subIssueNumber,
        {
          octokit,
          projectNumber: ctx.projectNumber,
          fetchPRs: false,
          fetchParent: false,
        },
      );

      await subUpdate({
        ...subData,
        issue: {
          ...subData.issue,
          assignees: subData.issue.assignees.filter(
            (a) => a !== action.botUsername,
          ),
        },
      });
      core.info(
        `Unassigned ${action.botUsername} from sub-issue #${subIssueNumber}`,
      );
    } catch (error) {
      core.warning(
        `Failed to unassign bot from sub-issue #${subIssueNumber}: ${error}`,
      );
    }
  }

  core.info(`Reset complete: ${resetCount} issues reopened`);
  return { resetCount };
}

// ============================================================================
// Label Executors
// ============================================================================

/**
 * Add a label to an issue
 */
export async function executeAddLabel(
  action: AddLabelAction,
  ctx: RunnerContext,
): Promise<{ added: boolean }> {
  try {
    const octokit = asOctokitLike(ctx);
    const { data, update } = await parseIssue(
      ctx.owner,
      ctx.repo,
      action.issueNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    await update({
      ...data,
      issue: {
        ...data.issue,
        labels: [...data.issue.labels, action.label],
      },
    });

    core.info(`Added label "${action.label}" to issue #${action.issueNumber}`);
    return { added: true };
  } catch (error) {
    core.warning(
      `Failed to add label "${action.label}" to issue #${action.issueNumber}: ${error}`,
    );
    return { added: false };
  }
}

/**
 * Remove a label from an issue
 */
export async function executeRemoveLabel(
  action: RemoveLabelAction,
  ctx: RunnerContext,
): Promise<{ removed: boolean }> {
  try {
    const octokit = asOctokitLike(ctx);
    const { data, update } = await parseIssue(
      ctx.owner,
      ctx.repo,
      action.issueNumber,
      {
        octokit,
        projectNumber: ctx.projectNumber,
        fetchPRs: false,
        fetchParent: false,
      },
    );

    await update({
      ...data,
      issue: {
        ...data.issue,
        labels: data.issue.labels.filter((l) => l !== action.label),
      },
    });

    core.info(
      `Removed label "${action.label}" from issue #${action.issueNumber}`,
    );
    return { removed: true };
  } catch (error) {
    // Don't fail if label wasn't present (404 error)
    if (error instanceof Error && error.message.includes("404")) {
      core.info(
        `Label "${action.label}" was not present on issue #${action.issueNumber}`,
      );
      return { removed: false };
    }
    core.warning(
      `Failed to remove label "${action.label}" from issue #${action.issueNumber}: ${error}`,
    );
    return { removed: false };
  }
}
