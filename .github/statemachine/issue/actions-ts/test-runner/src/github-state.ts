/**
 * GitHub state fetching utilities
 *
 * Fetches current state from GitHub API and converts to GitHubState format
 */

import type * as github from "@actions/github";
import type {
  MachineContext,
  ProjectStatus,
} from "../../state-machine/schemas/index.js";
import { parseTodoStats } from "../../state-machine/parser/todo-parser.js";
import { parseHistory } from "../../state-machine/parser/history-parser.js";
import type { GitHubState, WorkflowRun } from "./types.js";

type Octokit = ReturnType<typeof github.getOctokit>;

// GraphQL query to get issue state
const GET_ISSUE_STATE_QUERY = `
query GetIssueState($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
      number
      title
      body
      state
      assignees(first: 10) {
        nodes {
          login
        }
      }
      labels(first: 20) {
        nodes {
          name
        }
      }
      projectItems(first: 10) {
        nodes {
          id
          project {
            id
            number
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                    id
                  }
                }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field {
                  ... on ProjectV2Field {
                    name
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const GET_PR_FOR_ISSUE_QUERY = `
query GetPRForIssue($owner: String!, $repo: String!, $headRef: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 1, headRefName: $headRef, states: [OPEN, MERGED]) {
      nodes {
        number
        title
        state
        isDraft
        headRefName
        baseRefName
        headRefOid
        labels(first: 20) {
          nodes {
            name
          }
        }
      }
    }
  }
}
`;

const CHECK_BRANCH_EXISTS_QUERY = `
query CheckBranchExists($owner: String!, $repo: String!, $branchName: String!) {
  repository(owner: $owner, name: $repo) {
    ref(qualifiedName: $branchName) {
      name
      target {
        oid
      }
    }
  }
}
`;

interface IssueResponse {
  repository?: {
    issue?: {
      id?: string;
      number?: number;
      title?: string;
      body?: string;
      state?: string;
      assignees?: { nodes?: Array<{ login?: string }> };
      labels?: { nodes?: Array<{ name?: string }> };
      projectItems?: {
        nodes?: Array<{
          id?: string;
          project?: { id?: string; number?: number };
          fieldValues?: {
            nodes?: Array<{
              name?: string;
              number?: number;
              field?: { name?: string; id?: string };
            }>;
          };
        }>;
      };
    };
  };
}

interface PRResponse {
  repository?: {
    pullRequests?: {
      nodes?: Array<{
        number?: number;
        title?: string;
        state?: string;
        isDraft?: boolean;
        headRefName?: string;
        baseRefName?: string;
        headRefOid?: string;
        labels?: {
          nodes?: Array<{ name?: string }>;
        };
      }>;
    };
  };
}

interface BranchResponse {
  repository?: {
    ref?: {
      name?: string;
      target?: {
        oid?: string;
      };
    } | null;
  };
}

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
 * Fetch current GitHub state for an issue
 */
async function fetchGitHubState(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
  botUsername: string = "nopo-bot",
): Promise<GitHubState> {
  // Fetch issue data
  const issueResponse = await octokit.graphql<IssueResponse>(
    GET_ISSUE_STATE_QUERY,
    {
      owner,
      repo,
      issueNumber,
    },
  );

  const issue = issueResponse.repository?.issue;

  if (!issue) {
    throw new Error(`Issue #${issueNumber} not found`);
  }

  // Parse project fields
  const projectItems = issue.projectItems?.nodes || [];
  const projectItem = projectItems.find(
    (item) => item.project?.number === projectNumber,
  );

  let projectStatus: ProjectStatus | null = null;
  let iteration = 0;
  let failures = 0;

  if (projectItem?.fieldValues?.nodes) {
    for (const fieldValue of projectItem.fieldValues.nodes) {
      const fieldName = fieldValue.field?.name;
      if (fieldName === "Status" && fieldValue.name) {
        projectStatus = fieldValue.name as ProjectStatus;
      } else if (
        fieldName === "Iteration" &&
        typeof fieldValue.number === "number"
      ) {
        iteration = fieldValue.number;
      } else if (
        fieldName === "Failures" &&
        typeof fieldValue.number === "number"
      ) {
        failures = fieldValue.number;
      }
    }
  }

  // Parse assignees and labels
  const assignees =
    issue.assignees?.nodes?.map((a) => a.login || "").filter(Boolean) || [];
  const labels =
    issue.labels?.nodes?.map((l) => l.name || "").filter(Boolean) || [];

  // Parse todos and history from body
  const body = issue.body || "";
  const todos = parseTodoStats(body);
  const history = parseHistory(body);

  // Check if bot is assigned
  const botAssigned = assignees.includes(botUsername);

  // Derive branch name and check if it exists
  const branchName = deriveBranchName(issueNumber);
  let branchExists = false;
  let latestSha: string | null = null;

  try {
    const branchResponse = await octokit.graphql<BranchResponse>(
      CHECK_BRANCH_EXISTS_QUERY,
      {
        owner,
        repo,
        branchName: `refs/heads/${branchName}`,
      },
    );
    branchExists = branchResponse.repository?.ref !== null;
    latestSha = branchResponse.repository?.ref?.target?.oid || null;
  } catch {
    branchExists = false;
  }

  // Check for PR
  let prState: GitHubState["prState"] = null;
  let prNumber: number | null = null;
  let prLabels: string[] = [];

  if (branchExists) {
    try {
      const prResponse = await octokit.graphql<PRResponse>(
        GET_PR_FOR_ISSUE_QUERY,
        {
          owner,
          repo,
          headRef: branchName,
        },
      );

      const pr = prResponse.repository?.pullRequests?.nodes?.[0];
      if (pr) {
        prNumber = pr.number || null;
        if (pr.isDraft) {
          prState = "DRAFT";
        } else if (pr.state === "MERGED") {
          prState = "MERGED";
        } else if (pr.state === "CLOSED") {
          prState = "CLOSED";
        } else {
          prState = "OPEN";
        }
        latestSha = pr.headRefOid || latestSha;
        prLabels =
          pr.labels?.nodes?.map((l) => l.name || "").filter(Boolean) || [];
      }
    } catch {
      // No PR found
    }
  }

  return {
    issueNumber,
    issueState: (issue.state?.toUpperCase() || "OPEN") as "OPEN" | "CLOSED",
    projectStatus,
    iteration,
    failures,
    botAssigned,
    labels,
    uncheckedTodos: todos.uncheckedNonManual,
    prState,
    prNumber,
    prLabels,
    branch: branchExists ? branchName : null,
    branchExists,
    latestSha,
    context: null, // Will be populated separately if needed
    body,
    history,
  };
}

/**
 * Simulate human merge action for E2E tests
 *
 * When a PR has the "ready-to-merge" label, this function simulates
 * what a human would do: enable auto-merge via merge queue.
 *
 * Returns true if merge was initiated, false if not needed or failed.
 */
async function simulateMerge(
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
async function fetchRecentWorkflowRuns(
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
 * Fetch the most recent CI workflow run
 * @internal Reserved for future use
 */
async function _fetchLatestCIRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<WorkflowRun | null> {
  const runs = await fetchRecentWorkflowRuns(octokit, owner, repo, issueNumber);

  // Find the most recent CI workflow
  const ciRun = runs.find(
    (run) => run.name === "CI" || run.name.toLowerCase().includes("ci"),
  );

  return ciRun || runs[0] || null;
}

/**
 * Check if any workflows are currently running for an issue
 * @internal Reserved for future use
 */
async function _hasRunningWorkflows(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<boolean> {
  const runs = await fetchRecentWorkflowRuns(octokit, owner, repo, issueNumber);
  return runs.some(
    (run) => run.status === "in_progress" || run.status === "queued",
  );
}

// Keep references to avoid lint errors for reserved functions
void _fetchLatestCIRun;
void _hasRunningWorkflows;

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
