/**
 * update() — apply changes from a modified IssueStateData back to GitHub.
 */

import type { OctokitLike } from "./client.js";
import type { IssueStateData } from "./schemas/index.js";
import { computeDiff } from "./diff.js";
import { serializeBody } from "./markdown/body-serializer.js";

export async function updateIssue(
  original: IssueStateData,
  updated: IssueStateData,
  octokit: OctokitLike,
): Promise<void> {
  const { owner, repo } = updated;
  const diff = computeDiff(original.issue, updated.issue);

  const promises: Promise<unknown>[] = [];

  // Body or title changed
  if (diff.bodyChanged || diff.titleChanged) {
    const updateParams: {
      owner: string;
      repo: string;
      issue_number: number;
      body?: string;
      title?: string;
    } = {
      owner,
      repo,
      issue_number: updated.issue.number,
    };

    if (diff.bodyChanged) {
      updateParams.body = serializeBody({
        description: updated.issue.description,
        sections: updated.issue.sections,
        history: updated.issue.history,
        agentNotes: updated.issue.agentNotes,
      });
    }

    if (diff.titleChanged) {
      updateParams.title = updated.issue.title;
    }

    promises.push(octokit.rest.issues.update(updateParams));
  }

  // State changed (open/closed)
  if (diff.stateChanged) {
    promises.push(
      octokit.rest.issues.update({
        owner,
        repo,
        issue_number: updated.issue.number,
        state: updated.issue.state === "OPEN" ? "open" : "closed",
      }),
    );
  }

  // Labels added
  if (diff.labelsAdded.length > 0) {
    promises.push(
      octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: updated.issue.number,
        labels: diff.labelsAdded,
      }),
    );
  }

  // Labels removed (one per call)
  for (const label of diff.labelsRemoved) {
    promises.push(
      octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: updated.issue.number,
        name: label,
      }),
    );
  }

  // Assignees added
  if (diff.assigneesAdded.length > 0) {
    promises.push(
      octokit.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: updated.issue.number,
        assignees: diff.assigneesAdded,
      }),
    );
  }

  // Assignees removed
  if (diff.assigneesRemoved.length > 0) {
    promises.push(
      octokit.rest.issues.removeAssignees({
        owner,
        repo,
        issue_number: updated.issue.number,
        assignees: diff.assigneesRemoved,
      }),
    );
  }

  // Execute all independent operations in parallel
  await Promise.all(promises);
}
