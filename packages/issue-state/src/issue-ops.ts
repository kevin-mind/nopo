/**
 * Standalone issue operations (not part of issue state lifecycle).
 */

import type { OctokitLike } from "./client.js";

export interface IssueCommentData {
  id: number;
  body?: string;
  user?: { login?: string } | null;
  created_at: string;
}

export async function listComments(
  owner: string,
  repo: string,
  issueNumber: number,
  octokit: OctokitLike,
  opts?: { perPage?: number },
): Promise<IssueCommentData[]> {
  const result = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: opts?.perPage,
  });
  return result.data;
}

export interface IssueListItem {
  number: number;
  title: string;
  state: string;
  body?: string | null;
}

export async function listIssuesForRepo(
  owner: string,
  repo: string,
  octokit: OctokitLike,
  opts?: { labels?: string; state?: string; perPage?: number },
): Promise<IssueListItem[]> {
  const result = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: opts?.labels,
    state: opts?.state,
    per_page: opts?.perPage,
  });
  return result.data;
}

export async function setLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
  octokit: OctokitLike,
): Promise<void> {
  await octokit.rest.issues.setLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels,
  });
}
