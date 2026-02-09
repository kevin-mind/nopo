/**
 * parseIssue() — fetch a GitHub issue and return structured JSON + an update function.
 */

import type { OctokitLike } from "./client.js";
import type {
  IssueData,
  SubIssueData,
  IssueStateData,
  ProjectStatus,
  CIStatus,
  LinkedPR,
  IssueComment,
} from "./schemas/index.js";
import {
  CIStatusSchema,
  ReviewDecisionSchema,
  MergeableStateSchema,
  ProjectStatusSchema,
  PRStateSchema,
  IssueStateSchema,
} from "./schemas/index.js";
import type { ReviewDecision, MergeableState } from "./schemas/index.js";
import type {
  IssueResponse,
  PRResponse,
  BranchResponse,
  ProjectItemNode,
  SubIssueNode,
  IssueCommentNode,
  LinkedPRsResponse,
} from "./graphql/types.js";
import {
  GET_ISSUE_WITH_PROJECT_QUERY,
  GET_PR_FOR_BRANCH_QUERY,
  CHECK_BRANCH_EXISTS_QUERY,
  GET_ISSUE_LINKED_PRS_QUERY,
} from "./graphql/issue-queries.js";
import { parseMarkdown } from "./markdown/ast.js";
import { updateIssue, type UpdateIssueOptions } from "./update-issue.js";

export interface ParseIssueOptions {
  octokit: OctokitLike;
  projectNumber?: number;
  botUsername?: string;
  fetchPRs?: boolean;
  fetchParent?: boolean;
}

// Build update options from parse options
function buildUpdateOptions(options: ParseIssueOptions): UpdateIssueOptions {
  return {
    projectNumber: options.projectNumber,
  };
}

// ============================================================================
// Helpers
// ============================================================================

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
      status = ProjectStatusSchema.parse(fieldValue.name);
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
      return ProjectStatusSchema.parse(fieldValue.name);
    }
  }

  return null;
}

function deriveBranchName(
  parentIssueNumber: number,
  phaseNumber?: number,
): string {
  if (phaseNumber !== undefined && phaseNumber > 0) {
    return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
  }
  return `claude/issue/${parentIssueNumber}`;
}

function parseIssueComments(
  commentNodes: IssueCommentNode[],
  botUsername: string,
): IssueComment[] {
  return commentNodes.map((c) => {
    const author = c.author?.login ?? "unknown";
    return {
      id: c.id ?? "",
      author,
      body: c.body ?? "",
      createdAt: c.createdAt ?? "",
      isBot: author.includes("[bot]") || author === botUsername,
    };
  });
}

async function _checkBranchExists(
  octokit: OctokitLike,
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
 * Get all PRs linked to an issue via "Fixes #<number>" in the PR body.
 * Uses GitHub's timeline API which tracks issue-PR linkage automatically.
 */
async function getLinkedPRs(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<LinkedPR[]> {
  try {
    const response = await octokit.graphql<LinkedPRsResponse>(
      GET_ISSUE_LINKED_PRS_QUERY,
      { owner, repo, issueNumber },
    );

    const linkedPRs: LinkedPR[] = [];
    const timelineNodes =
      response.repository?.issue?.timelineItems?.nodes || [];

    for (const node of timelineNodes) {
      // Handle CrossReferencedEvent (source) and ConnectedEvent (subject)
      const pr = node.source || node.subject;
      if (!pr?.number || !pr?.headRefName) continue;

      // Avoid duplicates
      if (linkedPRs.some((p) => p.number === pr.number)) continue;

      linkedPRs.push({
        number: pr.number,
        state: PRStateSchema.parse(pr.state?.toUpperCase() || "OPEN"),
        isDraft: false, // Timeline doesn't include draft status
        title: pr.title || "",
        headRef: pr.headRefName,
        baseRef: "main", // Timeline doesn't include base ref
        ciStatus: null, // Timeline doesn't include CI status
      });
    }

    return linkedPRs;
  } catch {
    return [];
  }
}

async function getPRForBranch(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  headRef: string,
): Promise<LinkedPR | null> {
  try {
    const response = await octokit.graphql<PRResponse>(
      GET_PR_FOR_BRANCH_QUERY,
      { owner, repo, headRef },
    );

    const pr = response.repository?.pullRequests?.nodes?.[0];
    if (!pr || !pr.number) {
      return null;
    }

    const rawCiStatus =
      pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;

    let ciStatus: CIStatus | null = null;
    if (rawCiStatus) {
      const parsed = CIStatusSchema.safeParse(rawCiStatus);
      if (parsed.success) {
        ciStatus = parsed.data;
      }
    }

    let reviewDecision: ReviewDecision | null = null;
    if (pr.reviewDecision) {
      const parsed = ReviewDecisionSchema.safeParse(pr.reviewDecision);
      if (parsed.success) {
        reviewDecision = parsed.data;
      }
    }

    let mergeable: MergeableState | null = null;
    if (pr.mergeable) {
      const parsed = MergeableStateSchema.safeParse(pr.mergeable);
      if (parsed.success) {
        mergeable = parsed.data;
      }
    }

    return {
      number: pr.number,
      state: PRStateSchema.parse(pr.state?.toUpperCase() || "OPEN"),
      isDraft: pr.isDraft || false,
      title: pr.title || "",
      headRef: pr.headRefName || headRef,
      baseRef: pr.baseRefName || "main",
      ciStatus,
      reviewDecision,
      mergeable,
      reviewCount: pr.reviews?.totalCount ?? 0,
      url: pr.url || "",
    };
  } catch {
    return null;
  }
}

function parseSubIssueData(
  node: SubIssueNode,
  projectNumber: number,
  phaseNumber: number,
  parentIssueNumber: number,
): SubIssueData {
  const status = parseSubIssueStatus(
    node.projectItems?.nodes || [],
    projectNumber,
  );
  const body = node.body || "";
  const bodyAst = parseMarkdown(body);

  return {
    number: node.number || 0,
    title: node.title || "",
    state: IssueStateSchema.parse(node.state?.toUpperCase() || "OPEN"),
    bodyAst,
    projectStatus: status,
    branch: deriveBranchName(parentIssueNumber, phaseNumber),
    pr: null, // Populated separately if fetchPRs is true
  };
}

// ============================================================================
// Main
// ============================================================================

async function fetchIssueData(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
  botUsername: string,
  fetchPRs: boolean,
): Promise<{ issue: IssueData; parentIssueNumber: number | null } | null> {
  const response = await octokit.graphql<IssueResponse>(
    GET_ISSUE_WITH_PROJECT_QUERY,
    { owner, repo, issueNumber },
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
  const sortedSubIssues = [...subIssueNodes].sort(
    (a, b) => (a.number || 0) - (b.number || 0),
  );

  const subIssues: SubIssueData[] = [];
  for (let i = 0; i < sortedSubIssues.length; i++) {
    const node = sortedSubIssues[i];
    if (!node || !node.number) continue;
    const subIssue = parseSubIssueData(node, projectNumber, i + 1, issueNumber);

    if (fetchPRs) {
      // Get PRs linked to this sub-issue via "Fixes #<number>"
      const linkedPRs = await getLinkedPRs(octokit, owner, repo, node.number);
      if (linkedPRs.length > 0) {
        // Use the first linked PR (usually there's only one)
        const linkedPR = linkedPRs[0];
        if (linkedPR) {
          subIssue.branch = linkedPR.headRef;

          // Get full PR details including CI status
          subIssue.pr = await getPRForBranch(
            octokit,
            owner,
            repo,
            linkedPR.headRef,
          );
        }
      }
    }

    subIssues.push(subIssue);
  }

  const body = issue.body || "";
  const bodyAst = parseMarkdown(body);
  const comments = parseIssueComments(issue.comments?.nodes || [], botUsername);

  const parentIssueNumber = issue.parent?.number ?? null;

  // Get linked PRs for the issue itself
  let issueBranch: string | null = null;
  let issuePR: LinkedPR | null = null;
  if (fetchPRs) {
    const linkedPRs = await getLinkedPRs(octokit, owner, repo, issueNumber);
    const firstPR = linkedPRs[0];
    if (firstPR) {
      issueBranch = firstPR.headRef;
      issuePR = await getPRForBranch(octokit, owner, repo, issueBranch);
    }
  }

  return {
    issue: {
      number: issue.number || issueNumber,
      title: issue.title || "",
      state: IssueStateSchema.parse(issue.state?.toUpperCase() || "OPEN"),
      bodyAst,
      projectStatus: status,
      iteration,
      failures,
      assignees:
        issue.assignees?.nodes?.map((a) => a.login || "").filter(Boolean) || [],
      labels:
        issue.labels?.nodes?.map((l) => l.name || "").filter(Boolean) || [],
      subIssues,
      hasSubIssues: subIssues.length > 0,
      comments,
      branch: issueBranch,
      pr: issuePR,
      parentIssueNumber,
    },
    parentIssueNumber,
  };
}

export async function parseIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  options: ParseIssueOptions,
): Promise<{
  data: IssueStateData;
  update: (newData: IssueStateData) => Promise<void>;
}> {
  const {
    octokit,
    projectNumber = 0,
    botUsername = "nopo-bot",
    fetchPRs = true,
    fetchParent = true,
  } = options;

  const result = await fetchIssueData(
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
    botUsername,
    fetchPRs,
  );

  if (!result) {
    throw new Error(`Issue #${issueNumber} not found`);
  }

  let parentIssue: IssueData | null = null;
  if (fetchParent && result.parentIssueNumber) {
    const parentResult = await fetchIssueData(
      octokit,
      owner,
      repo,
      result.parentIssueNumber,
      projectNumber,
      botUsername,
      fetchPRs,
    );
    if (parentResult) {
      parentIssue = parentResult.issue;
    }
  }

  const data: IssueStateData = {
    owner,
    repo,
    issue: result.issue,
    parentIssue,
  };

  // Capture original snapshot for diffing
  const original = structuredClone(data);

  // Build update options (project number for field updates)
  const updateOptions = buildUpdateOptions(options);

  return {
    data,
    update: (newData: IssueStateData) =>
      updateIssue(original, newData, octokit, updateOptions),
  };
}
