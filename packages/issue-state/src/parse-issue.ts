/**
 * parseIssue() — fetch a GitHub issue and return structured JSON + an update function.
 */

import type { OctokitLike } from "./client.js";
import type {
  IssueData,
  SubIssueData,
  IssueStateData,
  ProjectStatus,
  IssueState,
  PRState,
  CIStatus,
  LinkedPR,
  IssueComment,
} from "./schemas/index.js";
import { CIStatusSchema } from "./schemas/index.js";
import type {
  IssueResponse,
  PRResponse,
  BranchResponse,
  ProjectItemNode,
  SubIssueNode,
  IssueCommentNode,
} from "./graphql/types.js";
import {
  GET_ISSUE_WITH_PROJECT_QUERY,
  GET_PR_FOR_BRANCH_QUERY,
  CHECK_BRANCH_EXISTS_QUERY,
} from "./graphql/issue-queries.js";
import { parseMarkdown } from "./markdown/ast.js";
import { updateIssue } from "./update-issue.js";

export interface ParseIssueOptions {
  octokit: OctokitLike;
  projectNumber?: number;
  botUsername?: string;
  fetchPRs?: boolean;
  fetchParent?: boolean;
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

async function checkBranchExists(
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

    return {
      number: pr.number,
      state: (pr.state?.toUpperCase() || "OPEN") as PRState,
      isDraft: pr.isDraft || false,
      title: pr.title || "",
      headRef: pr.headRefName || headRef,
      baseRef: pr.baseRefName || "main",
      ciStatus,
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
    state: (node.state?.toUpperCase() || "OPEN") as IssueState,
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
    if (!node) continue;
    const subIssue = parseSubIssueData(node, projectNumber, i + 1, issueNumber);

    if (fetchPRs && subIssue.branch) {
      const branchExists = await checkBranchExists(
        octokit,
        owner,
        repo,
        subIssue.branch,
      );
      if (branchExists) {
        subIssue.pr = await getPRForBranch(
          octokit,
          owner,
          repo,
          subIssue.branch,
        );
      }
    }

    subIssues.push(subIssue);
  }

  const body = issue.body || "";
  const bodyAst = parseMarkdown(body);
  const comments = parseIssueComments(issue.comments?.nodes || [], botUsername);

  const parentIssueNumber = issue.parent?.number ?? null;

  // Derive branch for the issue itself
  const issueBranch = deriveBranchName(issueNumber);
  let issuePR: LinkedPR | null = null;
  if (fetchPRs) {
    const branchExists = await checkBranchExists(
      octokit,
      owner,
      repo,
      issueBranch,
    );
    if (branchExists) {
      issuePR = await getPRForBranch(octokit, owner, repo, issueBranch);
    }
  }

  return {
    issue: {
      number: issue.number || issueNumber,
      title: issue.title || "",
      state: (issue.state?.toUpperCase() || "OPEN") as IssueState,
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

  return {
    data,
    update: (newData: IssueStateData) =>
      updateIssue(original, newData, octokit),
  };
}
