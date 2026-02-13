/**
 * AI-dependent state mutators.
 *
 * These states have multiple possible outcomes because they
 * involve Claude making decisions (triage, grooming, etc.).
 */

import type { StateMutator } from "./types.js";
import { cloneTree, addHistoryEntry, successEntry } from "./helpers.js";

/**
 * triaging: Claude triages the issue.
 *
 * Outcome 1: Successfully triaged (labels += triaged, body sections populated).
 * This is the only predictable structural outcome.
 */
export const triagingMutator: StateMutator = (current, context) => {
  const phase = String(context.currentPhase ?? "-");

  // Helper to apply common triage mutations to a fresh clone.
  const applyTriageMutations = (tree: ReturnType<typeof cloneTree>) => {
    if (!tree.issue.labels.includes("triaged")) {
      tree.issue.labels.push("triaged");
    }
    // Triage rewrites the body via updateIssueStructure() which always produces:
    //   ## Requirements  (from requirements array — always present)
    //   ## Approach      (from initial_approach — always present)
    //   ## Questions     (from initial_questions — optional)
    //   + preserved Iteration History / Agent Notes from existing body
    //
    // The original Description heading is replaced.
    tree.issue.body.hasDescription = false;
    tree.issue.body.hasRequirements = true;
    tree.issue.body.hasApproach = true;
    addHistoryEntry(tree.issue, {
      iteration: context.issue.iteration,
      phase,
      action: successEntry("triaging"),
    });
  };

  // Questions are optional — Claude may or may not produce them.
  // Clone from current independently for each outcome (same pattern as
  // iteratingMutator) so that cloneTree's history clearing doesn't
  // discard entries added by a prior fork.

  // Outcome 1: triage with questions
  const withQuestions = cloneTree(current);
  applyTriageMutations(withQuestions);
  withQuestions.issue.body.hasQuestions = true;

  // Outcome 2: triage without questions
  const withoutQuestions = cloneTree(current);
  applyTriageMutations(withoutQuestions);
  withoutQuestions.issue.body.hasQuestions = false;

  return [withQuestions, withoutQuestions];
};

/**
 * grooming: Claude grooms the issue.
 *
 * Multiple outcomes:
 * 1. Successfully groomed: labels += groomed (projectStatus unchanged — stays Backlog)
 * 2. Needs info: labels += needs-info
 * 3. Blocked: status → Blocked
 */
export const groomingMutator: StateMutator = (current, context) => {
  const phase = String(context.currentPhase ?? "-");
  const historyAction = successEntry("grooming");

  // Outcome 1: Successfully groomed — adds label, status stays as-is
  const ready = cloneTree(current);
  if (!ready.issue.labels.includes("groomed")) {
    ready.issue.labels.push("groomed");
  }
  addHistoryEntry(ready.issue, {
    iteration: context.issue.iteration,
    phase,
    action: historyAction,
  });

  // Outcome 2: Needs more info
  const needsInfo = cloneTree(current);
  if (!needsInfo.issue.labels.includes("needs-info")) {
    needsInfo.issue.labels.push("needs-info");
  }
  addHistoryEntry(needsInfo.issue, {
    iteration: context.issue.iteration,
    phase,
    action: historyAction,
  });

  // Outcome 3: Blocked
  const blocked = cloneTree(current);
  blocked.issue.projectStatus = "Blocked";
  addHistoryEntry(blocked.issue, {
    iteration: context.issue.iteration,
    phase,
    action: historyAction,
  });

  return [ready, needsInfo, blocked];
};

/**
 * commenting: Claude responds to a comment.
 * No predictable structural changes beyond history entry.
 */
export const commentingMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration,
    phase,
    action: successEntry("commenting"),
  });
  return [tree];
};

/**
 * pivoting: Claude analyzes pivot request.
 * No predictable structural changes beyond history entry (body changes are AI-dependent).
 */
export const pivotingMutator: StateMutator = (current, context) => {
  const tree = cloneTree(current);
  const phase = String(context.currentPhase ?? "-");
  addHistoryEntry(tree.issue, {
    iteration: context.issue.iteration,
    phase,
    action: successEntry("pivoting"),
  });
  return [tree];
};
