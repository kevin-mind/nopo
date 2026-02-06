/**
 * Field-level diff between two IssueData snapshots.
 */

import type { IssueData } from "./schemas/index.js";
import { serializeMarkdown } from "./markdown/ast.js";

export interface IssueDiff {
  bodyChanged: boolean;
  titleChanged: boolean;
  stateChanged: boolean;
  labelsAdded: string[];
  labelsRemoved: string[];
  assigneesAdded: string[];
  assigneesRemoved: string[];
  projectStatusChanged: boolean;
  iterationChanged: boolean;
  failuresChanged: boolean;
}

function setDifference(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return a.filter((x) => !bSet.has(x));
}

export function computeDiff(
  original: IssueData,
  updated: IssueData,
): IssueDiff {
  const originalBody = serializeMarkdown(original.bodyAst);
  const updatedBody = serializeMarkdown(updated.bodyAst);

  return {
    bodyChanged: originalBody !== updatedBody,
    titleChanged: original.title !== updated.title,
    stateChanged: original.state !== updated.state,
    labelsAdded: setDifference(updated.labels, original.labels),
    labelsRemoved: setDifference(original.labels, updated.labels),
    assigneesAdded: setDifference(updated.assignees, original.assignees),
    assigneesRemoved: setDifference(original.assignees, updated.assignees),
    projectStatusChanged: original.projectStatus !== updated.projectStatus,
    iterationChanged: original.iteration !== updated.iteration,
    failuresChanged: original.failures !== updated.failures,
  };
}
