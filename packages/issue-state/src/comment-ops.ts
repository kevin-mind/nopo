/**
 * Standalone comment operations (not part of issue state).
 */

import type { OctokitLike } from "./client.js";

export async function createComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  octokit: OctokitLike,
): Promise<{ commentId: number }> {
  const result = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
  return { commentId: result.data.id };
}

export async function updateComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
  octokit: OctokitLike,
): Promise<void> {
  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
}
