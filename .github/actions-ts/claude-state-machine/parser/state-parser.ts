import type { GitHub } from "@actions/github/lib/utils.js";
import type {
  MachineContext,
  ParentIssue,
  SubIssue,
  ProjectStatus,
  IssueState,
  PRState,
  LinkedPR,
  TriggerType,
  GitHubEvent,
} from "../schemas/index.js";
import { createMachineContext, eventToTrigger } from "../schemas/index.js";
import { parseTodoStats } from "./todo-parser.js";
import { parseHistory } from "./history-parser.js";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// GraphQL Queries
// ============================================================================

const GET_ISSUE_WITH_PROJECT_QUERY = `
query GetIssueWithProject($owner: String!, $repo: String!, $issueNumber: Int!) {
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
      subIssues(first: 20) {
        nodes {
          id
          number
          title
          body
          state
          projectItems(first: 10) {
            nodes {
              project {
                number
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
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
  }
}
`;

const GET_PR_FOR_BRANCH_QUERY = `
query GetPRForBranch($owner: String!, $repo: String!, $headRef: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 1, headRefName: $headRef, states: [OPEN, MERGED]) {
      nodes {
        number
        title
        state
        isDraft
        headRefName
        baseRefName
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
    }
  }
}
`;

// ============================================================================
// Response Type Definitions
// ============================================================================

interface ProjectFieldValue {
  name?: string;
  number?: number;
  field?: { name?: string; id?: string };
}

interface ProjectItemNode {
  id?: string;
  project?: { id?: string; number?: number };
  fieldValues?: { nodes?: ProjectFieldValue[] };
}

interface SubIssueNode {
  id?: string;
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  projectItems?: { nodes?: ProjectItemNode[] };
}

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
      projectItems?: { nodes?: ProjectItemNode[] };
      subIssues?: { nodes?: SubIssueNode[] };
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
      }>;
    };
  };
}

interface BranchResponse {
  repository?: {
    ref?: { name?: string } | null;
  };
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse project state from GraphQL response
 */
function parseProjectState(
  projectItems: ProjectItemNode[],
  projectNumber: number,
): { status: ProjectStatus | null; iteration: number; failures: number } {
  const projectItem = projectItems.find(
    (item) => item.project?.number === projectNumber,
  );

  if (!projectItem) {
    return { status: null, iteration: 0, failures: 0 };
  }

  let status: ProjectStatus | null = null;
  let iteration = 0;
  let failures = 0;

  const fieldValues = projectItem.fieldValues?.nodes || [];
  for (const fieldValue of fieldValues) {
    const fieldName = fieldValue.field?.name;
    if (fieldName === "Status" && fieldValue.name) {
      status = fieldValue.name as ProjectStatus;
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

  return { status, iteration, failures };
}

/**
 * Parse sub-issue status from project items
 */
function parseSubIssueStatus(
  projectItems: ProjectItemNode[],
  projectNumber: number,
): ProjectStatus | null {
  const projectItem = projectItems.find(
    (item) => item.project?.number === projectNumber,
  );

  if (!projectItem?.fieldValues?.nodes) {
    return null;
  }

  for (const fieldValue of projectItem.fieldValues.nodes) {
    if (fieldValue.field?.name === "Status" && fieldValue.name) {
      return fieldValue.name as ProjectStatus;
    }
  }

  return null;
}

/**
 * Derive branch name from issue number and phase
 */
export function deriveBranchName(
  parentIssueNumber: number,
  phaseNumber?: number,
): string {
  if (phaseNumber !== undefined && phaseNumber > 0) {
    return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
  }
  return `claude/issue/${parentIssueNumber}`;
}

/**
 * Parse a sub-issue into our schema format
 */
function parseSubIssue(
  node: SubIssueNode,
  projectNumber: number,
  phaseNumber: number,
  parentIssueNumber: number,
): SubIssue {
  const status = parseSubIssueStatus(
    node.projectItems?.nodes || [],
    projectNumber,
  );
  const body = node.body || "";

  return {
    number: node.number || 0,
    title: node.title || "",
    state: (node.state?.toUpperCase() || "OPEN") as IssueState,
    body,
    projectStatus: status,
    branch: deriveBranchName(parentIssueNumber, phaseNumber),
    pr: null, // Will be populated separately
    todos: parseTodoStats(body),
  };
}

/**
 * Check if a branch exists
 */
async function checkBranchExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
): Promise<boolean> {
  try {
    const response = await octokit.graphql<BranchResponse>(
      CHECK_BRANCH_EXISTS_QUERY,
      {
        owner,
        repo,
        branchName: `refs/heads/${branchName}`,
      },
    );
    return response.repository?.ref !== null;
  } catch {
    return false;
  }
}

/**
 * Get PR for a branch
 */
async function getPRForBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  headRef: string,
): Promise<LinkedPR | null> {
  try {
    const response = await octokit.graphql<PRResponse>(
      GET_PR_FOR_BRANCH_QUERY,
      {
        owner,
        repo,
        headRef,
      },
    );

    const pr = response.repository?.pullRequests?.nodes?.[0];
    if (!pr || !pr.number) {
      return null;
    }

    return {
      number: pr.number,
      state: (pr.state?.toUpperCase() || "OPEN") as PRState,
      isDraft: pr.isDraft || false,
      title: pr.title || "",
      headRef: pr.headRefName || headRef,
      baseRef: pr.baseRefName || "main",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch full issue state from GitHub
 */
async function fetchIssueState(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<ParentIssue | null> {
  const response = await octokit.graphql<IssueResponse>(
    GET_ISSUE_WITH_PROJECT_QUERY,
    {
      owner,
      repo,
      issueNumber,
    },
  );

  const issue = response.repository?.issue;
  if (!issue) {
    return null;
  }

  const projectItems = issue.projectItems?.nodes || [];
  const { status, iteration, failures } = parseProjectState(
    projectItems,
    projectNumber,
  );

  const subIssueNodes = issue.subIssues?.nodes || [];
  const subIssues: SubIssue[] = [];

  // Sort sub-issues by number to maintain phase order
  const sortedSubIssues = [...subIssueNodes].sort(
    (a, b) => (a.number || 0) - (b.number || 0),
  );

  for (let i = 0; i < sortedSubIssues.length; i++) {
    const node = sortedSubIssues[i];
    if (!node) continue;
    subIssues.push(parseSubIssue(node, projectNumber, i + 1, issueNumber));
  }

  const body = issue.body || "";
  const history = parseHistory(body);
  const todos = parseTodoStats(body);

  return {
    number: issue.number || issueNumber,
    title: issue.title || "",
    state: (issue.state?.toUpperCase() || "OPEN") as IssueState,
    body,
    projectStatus: status,
    iteration,
    failures,
    assignees:
      issue.assignees?.nodes?.map((a) => a.login || "").filter(Boolean) || [],
    labels: issue.labels?.nodes?.map((l) => l.name || "").filter(Boolean) || [],
    subIssues,
    hasSubIssues: subIssues.length > 0,
    history,
    todos,
  };
}

/**
 * Find current phase from sub-issues
 */
function findCurrentPhase(
  subIssues: SubIssue[],
): { phase: number; subIssue: SubIssue } | null {
  for (let i = 0; i < subIssues.length; i++) {
    const subIssue = subIssues[i];
    if (!subIssue) continue;
    if (subIssue.projectStatus !== "Done" && subIssue.state === "OPEN") {
      return { phase: i + 1, subIssue };
    }
  }
  return null;
}

/**
 * Enrich sub-issues with PR information
 */
async function enrichSubIssuesWithPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  parentIssueNumber: number,
  subIssues: SubIssue[],
): Promise<SubIssue[]> {
  const enriched: SubIssue[] = [];

  for (let i = 0; i < subIssues.length; i++) {
    const subIssue = subIssues[i];
    if (!subIssue) continue;

    const branchName = deriveBranchName(parentIssueNumber, i + 1);
    const pr = await getPRForBranch(octokit, owner, repo, branchName);

    enriched.push({
      ...subIssue,
      branch: branchName,
      pr,
    });
  }

  return enriched;
}

/**
 * Build full machine context from an event and fetched state
 */
export async function buildMachineContext(
  octokit: Octokit,
  event: GitHubEvent,
  projectNumber: number,
  options: {
    maxRetries?: number;
    botUsername?: string;
    commentContextType?: "Issue" | "PR" | null;
    commentContextDescription?: string | null;
    branch?: string | null;
    // Override trigger - use this instead of deriving from event
    // This is needed because some triggers (issue_triage, issue_orchestrate)
    // use a different event type internally but need to preserve their trigger
    triggerOverride?: TriggerType | null;
  } = {},
): Promise<MachineContext | null> {
  const { owner, repo } = event;
  // Use trigger override if provided, otherwise derive from event
  const trigger = options.triggerOverride ?? eventToTrigger(event);

  // Determine the issue number from the event
  let issueNumber: number | undefined;
  if ("issueNumber" in event) {
    issueNumber = event.issueNumber;
  } else if ("prNumber" in event && event.issueNumber) {
    issueNumber = event.issueNumber;
  }

  if (!issueNumber) {
    return null;
  }

  // Fetch the main issue
  const issue = await fetchIssueState(
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
  );

  if (!issue) {
    return null;
  }

  // Enrich sub-issues with PR information
  if (issue.hasSubIssues) {
    issue.subIssues = await enrichSubIssuesWithPRs(
      octokit,
      owner,
      repo,
      issueNumber,
      issue.subIssues,
    );
  }

  // Find current phase
  const currentPhaseInfo = findCurrentPhase(issue.subIssues);
  const currentPhase = currentPhaseInfo?.phase ?? null;
  const currentSubIssue = currentPhaseInfo?.subIssue ?? null;

  // Determine branch
  const branch = currentPhase
    ? deriveBranchName(issueNumber, currentPhase)
    : deriveBranchName(issueNumber);

  const hasBranch = await checkBranchExists(octokit, owner, repo, branch);

  // Get PR for current branch
  const pr = hasBranch
    ? await getPRForBranch(octokit, owner, repo, branch)
    : null;

  // Extract CI result if this is a workflow run event
  let ciResult = null;
  let ciRunUrl = null;
  let ciCommitSha = null;
  if (event.type === "workflow_run_completed") {
    ciResult = event.result;
    ciRunUrl = event.runUrl;
    ciCommitSha = event.headSha;
  }

  // Extract review decision if this is a review event
  let reviewDecision = null;
  let reviewerId = null;
  if (event.type === "pr_review_submitted") {
    reviewDecision = event.decision;
    reviewerId = event.reviewer;
  }

  return createMachineContext({
    trigger,
    owner,
    repo,
    issue,
    parentIssue: null, // TODO: Support sub-issue triggers
    currentPhase,
    totalPhases: issue.subIssues.length || 1,
    currentSubIssue,
    ciResult,
    ciRunUrl,
    ciCommitSha,
    reviewDecision,
    reviewerId,
    branch: options.branch || branch,
    hasBranch,
    pr,
    hasPR: pr !== null,
    commentContextType: options.commentContextType ?? null,
    commentContextDescription: options.commentContextDescription ?? null,
    maxRetries: options.maxRetries,
    botUsername: options.botUsername,
  });
}
