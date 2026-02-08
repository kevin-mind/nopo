/**
 * update() — apply changes from a modified IssueStateData back to GitHub.
 */

import type { OctokitLike } from "./client.js";
import type { IssueStateData } from "./schemas/index.js";
import { computeDiff } from "./diff.js";
import { serializeMarkdown } from "./markdown/ast.js";
import { updateProjectFields } from "./project-helpers.js";

export interface UpdateIssueOptions {
  /** Project number for updating project fields */
  projectNumber?: number;
}

export async function updateIssue(
  original: IssueStateData,
  updated: IssueStateData,
  octokit: OctokitLike,
  options: UpdateIssueOptions = {},
): Promise<void> {
  const { owner, repo } = updated;
  const diff = computeDiff(original.issue, updated.issue);
  const { projectNumber } = options;

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
      updateParams.body = serializeMarkdown(updated.issue.bodyAst);
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

  // Project fields changed
  if (
    projectNumber &&
    (diff.projectStatusChanged ||
      diff.iterationChanged ||
      diff.failuresChanged)
  ) {
    const fieldsToUpdate: {
      status?: typeof updated.issue.projectStatus;
      iteration?: number;
      failures?: number;
    } = {};

    if (diff.projectStatusChanged) {
      fieldsToUpdate.status = updated.issue.projectStatus;
    }

    if (diff.iterationChanged) {
      fieldsToUpdate.iteration = updated.issue.iteration;
    }

    if (diff.failuresChanged) {
      fieldsToUpdate.failures = updated.issue.failures;
    }

    promises.push(
      updateProjectFields(
        octokit,
        owner,
        repo,
        updated.issue.number,
        projectNumber,
        fieldsToUpdate,
      ),
    );
  }

  // Execute all independent operations in parallel
  await Promise.all(promises);
}
