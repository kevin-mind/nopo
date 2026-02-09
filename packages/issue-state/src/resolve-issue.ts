import type { OctokitLike } from "./client.js";
import {
  GET_PR_CLOSING_ISSUES_QUERY,
  GET_BRANCH_CLOSING_ISSUES_QUERY,
} from "./graphql/pr-queries.js";
import { GET_ISSUE_BODY_QUERY } from "./graphql/issue-queries.js";
import type {
  PRClosingIssuesResponse,
  BranchClosingIssuesResponse,
  IssueParentResponse,
} from "./graphql/types.js";

/**
 * Resolve a PR number to the issue it closes via `closingIssuesReferences`.
 * Returns the first closing issue's number, or `null`.
 */
export async function issueNumberFromPR(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<number | null> {
  const response = await octokit.graphql<PRClosingIssuesResponse>(
    GET_PR_CLOSING_ISSUES_QUERY,
    { owner, repo, prNumber },
  );
  return (
    response.repository?.pullRequest?.closingIssuesReferences?.nodes?.[0]
      ?.number ?? null
  );
}

/**
 * Resolve a branch name to the issue closed by its PR via `closingIssuesReferences`.
 * Returns the first closing issue's number from the first PR on that branch, or `null`.
 */
export async function issueNumberFromBranch(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  branch: string,
): Promise<number | null> {
  const response = await octokit.graphql<BranchClosingIssuesResponse>(
    GET_BRANCH_CLOSING_ISSUES_QUERY,
    { owner, repo, headRef: branch },
  );
  return (
    response.repository?.pullRequests?.nodes?.[0]?.closingIssuesReferences
      ?.nodes?.[0]?.number ?? null
  );
}

/**
 * Resolve a sub-issue number to its parent issue number.
 * Reuses GET_ISSUE_BODY_QUERY which already returns `parent { number }`.
 * Returns the parent's number, or `null`.
 */
export async function parentIssueNumber(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  subIssueNumber: number,
): Promise<number | null> {
  const response = await octokit.graphql<IssueParentResponse>(
    GET_ISSUE_BODY_QUERY,
    { owner, repo, issueNumber: subIssueNumber },
  );
  return response.repository?.issue?.parent?.number ?? null;
}
