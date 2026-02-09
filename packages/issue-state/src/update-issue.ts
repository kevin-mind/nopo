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

  // Body, title, or state changed — combine into a single update call
  // to avoid GitHub "Validation Failed" from concurrent updates on the same issue
  if (diff.bodyChanged || diff.titleChanged || diff.stateChanged) {
    const updateParams: {
      owner: string;
      repo: string;
      issue_number: number;
      body?: string;
      title?: string;
      state?: string;
      state_reason?: string;
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

    if (diff.stateChanged) {
      updateParams.state = updated.issue.state === "OPEN" ? "open" : "closed";
      if (updated.issue.state === "CLOSED" && updated.issue.stateReason) {
        updateParams.state_reason = updated.issue.stateReason;
      }
    }

    promises.push(octokit.rest.issues.update(updateParams));
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
    (diff.projectStatusChanged || diff.iterationChanged || diff.failuresChanged)
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
