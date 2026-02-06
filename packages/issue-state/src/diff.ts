/**
 * Field-level diff between two IssueData snapshots.
 */

import type { IssueData } from "./schemas/index.js";
import { serializeBody } from "./markdown/body-serializer.js";

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
  // Compare serialized body to detect content changes
  const originalBody = serializeBody({
    description: original.description,
    sections: original.sections,
    history: original.history,
    agentNotes: original.agentNotes,
  });

  const updatedBody = serializeBody({
    description: updated.description,
    sections: updated.sections,
    history: updated.history,
    agentNotes: updated.agentNotes,
  });

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
