/**
 * GitHub state fetching utilities
 *
 * Uses @more/issue-state for fetching and converts to GitHubState format
 */

import type * as github from "@actions/github";
import {
  type MachineContext,
  parseTodoStats,
  parseHistory,
} from "@more/statemachine";
import {
  parseIssue,
  serializeMarkdown,
  type IssueStateData,
} from "@more/issue-state";
import type { GitHubState, WorkflowRun } from "./types.js";

type Octokit = ReturnType<typeof github.getOctokit>;

/**
 * Derive branch name from issue number
 */
export function deriveBranchName(issueNumber: number, phase?: number): string {
  if (phase !== undefined && phase > 0) {
    return `claude/issue/${issueNumber}/phase-${phase}`;
  }
  return `claude/issue/${issueNumber}`;
}

/**
 * Convert IssueStateData to GitHubState format
 */
function issueStateToGitHubState(data: IssueStateData): GitHubState {
  const { issue } = data;
  const body = serializeMarkdown(issue.bodyAst);

  // Parse todos and history from body
  const todos = parseTodoStats(body);
  const history = parseHistory(body);

  // Determine PR state
  let prState: GitHubState["prState"] = null;
  if (issue.pr) {
    if (issue.pr.isDraft) {
      prState = "DRAFT";
    } else if (issue.pr.state === "MERGED") {
      prState = "MERGED";
    } else if (issue.pr.state === "CLOSED") {
      prState = "CLOSED";
    } else {
      prState = "OPEN";
    }
  }

  return {
    issueNumber: issue.number,
    issueState: issue.state,
    projectStatus: issue.projectStatus,
    iteration: issue.iteration,
    failures: issue.failures,
    botAssigned: issue.assignees.includes("nopo-bot"),
    labels: issue.labels,
    uncheckedTodos: todos.uncheckedNonManual,
    prState,
    prNumber: issue.pr?.number ?? null,
    prLabels: [], // TODO: PR labels not currently in IssueStateData
    branch: issue.branch,
    branchExists: issue.branch !== null,
    latestSha: null, // TODO: Could be extracted from PR if needed
    context: null, // Will be populated separately if needed
    body,
    history,
  };
}

/**
 * Fetch current GitHub state for an issue
 *
 * Uses parseIssue from @more/issue-state and converts to GitHubState format.
 */
export async function fetchGitHubState(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
  botUsername: string = "nopo-bot",
): Promise<GitHubState> {
  const { data } = await parseIssue(owner, repo, issueNumber, {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
    octokit: octokit as Parameters<typeof parseIssue>[3]["octokit"],
    projectNumber,
    botUsername,
    fetchPRs: true,
    fetchParent: false,
  });

  const state = issueStateToGitHubState(data);

  // Override bot check if different username
  if (botUsername !== "nopo-bot") {
    state.botAssigned = data.issue.assignees.includes(botUsername);
  }

  return state;
}

/**
 * Simulate human merge action for E2E tests
 *
 * When a PR has the "ready-to-merge" label, this function simulates
 * what a human would do: enable auto-merge via merge queue.
 *
 * Returns true if merge was initiated, false if not needed or failed.
 */
export async function simulateMerge(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<boolean> {
  try {
    // Enable auto-merge via the merge queue
    // This is what a human would do via the GitHub UI
    await octokit.graphql(
      `
      mutation EnableAutoMerge($prId: ID!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: SQUASH }) {
          pullRequest {
            autoMergeRequest {
              enabledAt
            }
          }
        }
      }
      `,
      {
        prId: await getPullRequestNodeId(octokit, owner, repo, prNumber),
      },
    );
    return true;
  } catch {
    // If auto-merge fails (e.g., merge queue not enabled), try direct merge
    try {
      await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: "squash",
      });
      return true;
    } catch (mergeError) {
      console.error(`Failed to merge PR #${prNumber}:`, mergeError);
      return false;
    }
  }
}

/**
 * Get the GraphQL node ID for a pull request
 */
async function getPullRequestNodeId(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> {
  const response = await octokit.graphql<{
    repository?: { pullRequest?: { id: string } };
  }>(
    `
    query GetPRNodeId($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          id
        }
      }
    }
    `,
    { owner, repo, prNumber },
  );
  const id = response.repository?.pullRequest?.id;
  if (!id) {
    throw new Error(`PR #${prNumber} not found`);
  }
  return id;
}

/**
 * Fetch recent workflow runs for an issue
 */
export async function fetchRecentWorkflowRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  maxRuns: number = 10,
): Promise<WorkflowRun[]> {
  // Get the branch name for this issue
  const branchName = deriveBranchName(issueNumber);

  try {
    // Fetch workflow runs for the branch
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch: branchName,
      per_page: maxRuns,
    });

    return data.workflow_runs.map((run) => ({
      id: run.id,
      name: run.name || "Unknown",
      displayTitle: run.display_title || run.name || "Unknown",
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub API run.status is string but always one of these values
      status: run.status as "queued" | "in_progress" | "completed",
      conclusion: run.conclusion,
      url: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      headSha: run.head_sha,
      branch: run.head_branch,
    }));
  } catch {
    return [];
  }
}

/**
 * Build a minimal machine context from GitHub state
 *
 * This is used for state prediction when we only have API data
 */
export function buildContextFromState(
  state: GitHubState,
  owner: string,
  repo: string,
  trigger: MachineContext["trigger"] = "issue_edited",
): MachineContext {
  return {
    trigger,
    owner,
    repo,
    issue: {
      number: state.issueNumber,
      title: "",
      state: state.issueState,
      body: "",
      projectStatus: state.projectStatus,
      iteration: state.iteration,
      failures: state.failures,
      assignees: state.botAssigned ? ["nopo-bot"] : [],
      labels: state.labels,
      subIssues: [],
      hasSubIssues: false,
      history: [],
      todos: {
        total: state.uncheckedTodos,
        completed: 0,
        uncheckedNonManual: state.uncheckedTodos,
      },
    },
    parentIssue: null,
    currentPhase: null,
    totalPhases: 0,
    currentSubIssue: null,
    ciResult: null,
    ciRunUrl: null,
    ciCommitSha: null,
    workflowStartedAt: null,
    reviewDecision: null,
    reviewerId: null,
    branch: state.branch,
    hasBranch: state.branchExists,
    pr: state.prNumber
      ? {
          number: state.prNumber,
          state:
            state.prState === "MERGED"
              ? "MERGED"
              : state.prState === "CLOSED"
                ? "CLOSED"
                : "OPEN",
          isDraft: state.prState === "DRAFT",
          title: "",
          headRef: state.branch || "",
          baseRef: "main",
        }
      : null,
    hasPR: state.prNumber !== null,
    commentContextType: null,
    commentContextDescription: null,
    releaseEvent: null,
    discussion: null,
    maxRetries: 5,
    botUsername: "nopo-bot",
  };
}
