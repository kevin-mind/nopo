/**
 * AI-dependent state mutators.
 *
 * These states have multiple possible outcomes because they
 * involve Claude making decisions (triage, grooming, etc.).
 */

import type { StateMutator } from "./types.js";
import { cloneTree } from "./helpers.js";

/**
 * triaging: Claude triages the issue.
 *
 * Outcome 1: Successfully triaged (labels += triaged, body sections populated).
 * This is the only predictable structural outcome.
 */
export const triagingMutator: StateMutator = (current) => {
  const tree = cloneTree(current);

  // Triage adds the "triaged" label
  if (!tree.issue.labels.includes("triaged")) {
    tree.issue.labels.push("triaged");
  }

  return [tree];
};

/**
 * grooming: Claude grooms the issue.
 *
 * Multiple outcomes:
 * 1. Ready: labels += groomed, status → Ready
 * 2. Needs info: labels += needs-info
 * 3. Blocked: status → Blocked
 */
export const groomingMutator: StateMutator = (current) => {
  // Outcome 1: Successfully groomed
  const ready = cloneTree(current);
  if (!ready.issue.labels.includes("groomed")) {
    ready.issue.labels.push("groomed");
  }
  ready.issue.projectStatus = "Ready";

  // Outcome 2: Needs more info
  const needsInfo = cloneTree(current);
  if (!needsInfo.issue.labels.includes("needs-info")) {
    needsInfo.issue.labels.push("needs-info");
  }

  // Outcome 3: Blocked
  const blocked = cloneTree(current);
  blocked.issue.projectStatus = "Blocked";

  return [ready, needsInfo, blocked];
};

/**
 * commenting: Claude responds to a comment.
 * No predictable structural changes.
 */
export const commentingMutator: StateMutator = (current) => {
  return [cloneTree(current)];
};

/**
 * pivoting: Claude analyzes pivot request.
 * No predictable structural changes (body changes are AI-dependent).
 */
export const pivotingMutator: StateMutator = (current) => {
  return [cloneTree(current)];
};
