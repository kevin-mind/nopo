/**
 * State Tree Comparison Engine
 *
 * Compares expected (predicted) state trees against actual post-execution state.
 * Union-aware: tries each expected outcome tree, passes if ANY matches.
 */

import type {
  PredictableStateTree,
  PredictableIssueState,
  PredictableSubIssueState,
} from "./predictable-state.js";
import type {
  SubIssueBodyStructure,
  ParentIssueBodyStructure,
} from "../../../core/constants.js";
import {
  diffExact,
  diffGte,
  diffLte,
  diffSuperset,
  diffBooleanFlag,
  diffHistoryEntries,
  type FieldDiff,
  type VerifyResult,
} from "../../../core/verifier/index.js";

export type { FieldDiff, VerifyResult };

// ============================================================================
// Body Structure Comparison
// ============================================================================

function compareSubIssueBody(
  path: string,
  expected: SubIssueBodyStructure,
  actual: SubIssueBodyStructure,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Section flags (only check if expected=true)
  const flags = [
    "hasDescription",
    "hasTodos",
    "hasHistory",
    "hasAgentNotes",
    "hasQuestions",
    "hasAffectedAreas",
  ] as const;

  for (const flag of flags) {
    const d = diffBooleanFlag(`${path}.${flag}`, expected[flag], actual[flag]);
    if (d) diffs.push(d);
  }

  // Todo stats
  if (expected.todoStats && actual.todoStats) {
    const d1 = diffGte(
      `${path}.todoStats.total`,
      expected.todoStats.total,
      actual.todoStats.total,
    );
    if (d1) diffs.push(d1);

    const d2 = diffGte(
      `${path}.todoStats.completed`,
      expected.todoStats.completed,
      actual.todoStats.completed,
    );
    if (d2) diffs.push(d2);

    const d3 = diffLte(
      `${path}.todoStats.uncheckedNonManual`,
      expected.todoStats.uncheckedNonManual,
      actual.todoStats.uncheckedNonManual,
    );
    if (d3) diffs.push(d3);
  }

  // Question stats
  if (expected.questionStats && actual.questionStats) {
    const d1 = diffGte(
      `${path}.questionStats.total`,
      expected.questionStats.total,
      actual.questionStats.total,
    );
    if (d1) diffs.push(d1);

    const d2 = diffGte(
      `${path}.questionStats.answered`,
      expected.questionStats.answered,
      actual.questionStats.answered,
    );
    if (d2) diffs.push(d2);
  }

  // History entries
  diffs.push(
    ...diffHistoryEntries(
      `${path}.historyEntries`,
      expected.historyEntries,
      actual.historyEntries,
    ),
  );

  return diffs;
}

function compareParentBody(
  path: string,
  expected: ParentIssueBodyStructure,
  actual: ParentIssueBodyStructure,
): FieldDiff[] {
  const diffs = compareSubIssueBody(path, expected, actual);

  // Parent-only flags
  const parentFlags = [
    "hasRequirements",
    "hasApproach",
    "hasAcceptanceCriteria",
    "hasTesting",
    "hasRelated",
  ] as const;

  for (const flag of parentFlags) {
    const d = diffBooleanFlag(`${path}.${flag}`, expected[flag], actual[flag]);
    if (d) diffs.push(d);
  }

  return diffs;
}

// ============================================================================
// Issue Comparison
// ============================================================================

function compareIssue(
  path: string,
  expected: PredictableIssueState,
  actual: PredictableIssueState,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Exact matches
  const d1 = diffExact(`${path}.state`, expected.state, actual.state);
  if (d1) diffs.push(d1);

  const d2 = diffExact(
    `${path}.projectStatus`,
    expected.projectStatus,
    actual.projectStatus,
  );
  if (d2) diffs.push(d2);

  // iteration: actual >= expected
  const d3 = diffGte(`${path}.iteration`, expected.iteration, actual.iteration);
  if (d3) diffs.push(d3);

  // failures: exact OR 0 if cleared
  if (expected.failures !== actual.failures && actual.failures !== 0) {
    diffs.push({
      path: `${path}.failures`,
      expected: expected.failures,
      actual: actual.failures,
      comparison: "exact",
    });
  }

  // labels: expected ⊆ actual
  const d5 = diffSuperset(`${path}.labels`, expected.labels, actual.labels);
  if (d5) diffs.push(d5);

  // assignees: expected ⊆ actual
  const d6 = diffSuperset(
    `${path}.assignees`,
    expected.assignees,
    actual.assignees,
  );
  if (d6) diffs.push(d6);

  // Boolean flags
  const d7 = diffBooleanFlag(
    `${path}.hasBranch`,
    expected.hasBranch,
    actual.hasBranch,
  );
  if (d7) diffs.push(d7);

  const d8 = diffBooleanFlag(`${path}.hasPR`, expected.hasPR, actual.hasPR);
  if (d8) diffs.push(d8);

  // PR comparison
  if (expected.pr && actual.pr) {
    const d9 = diffExact(
      `${path}.pr.isDraft`,
      expected.pr.isDraft,
      actual.pr.isDraft,
    );
    if (d9) diffs.push(d9);

    const d10 = diffExact(
      `${path}.pr.state`,
      expected.pr.state,
      actual.pr.state,
    );
    if (d10) diffs.push(d10);
  }

  // Body structure
  diffs.push(...compareParentBody(`${path}.body`, expected.body, actual.body));

  return diffs;
}

// ============================================================================
// Sub-Issue Comparison
// ============================================================================

function compareSubIssue(
  path: string,
  expected: PredictableSubIssueState,
  actual: PredictableSubIssueState,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  const d1 = diffExact(`${path}.state`, expected.state, actual.state);
  if (d1) diffs.push(d1);

  const d2 = diffExact(
    `${path}.projectStatus`,
    expected.projectStatus,
    actual.projectStatus,
  );
  if (d2) diffs.push(d2);

  const d3 = diffSuperset(`${path}.labels`, expected.labels, actual.labels);
  if (d3) diffs.push(d3);

  const d4 = diffBooleanFlag(
    `${path}.hasBranch`,
    expected.hasBranch,
    actual.hasBranch,
  );
  if (d4) diffs.push(d4);

  const d5 = diffBooleanFlag(`${path}.hasPR`, expected.hasPR, actual.hasPR);
  if (d5) diffs.push(d5);

  if (expected.pr && actual.pr) {
    const d6 = diffExact(
      `${path}.pr.isDraft`,
      expected.pr.isDraft,
      actual.pr.isDraft,
    );
    if (d6) diffs.push(d6);

    const d7 = diffExact(
      `${path}.pr.state`,
      expected.pr.state,
      actual.pr.state,
    );
    if (d7) diffs.push(d7);
  }

  diffs.push(
    ...compareSubIssueBody(`${path}.body`, expected.body, actual.body),
  );

  return diffs;
}

// ============================================================================
// Tree Comparison
// ============================================================================

/**
 * Compare a single expected tree against actual. Returns field-level diffs.
 * Used by BaseVerifier.compareTree() in MachineVerifier.
 */
export function compareTreeFields(
  expected: PredictableStateTree,
  actual: PredictableStateTree,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Compare root issue
  diffs.push(...compareIssue("issue", expected.issue, actual.issue));

  // Compare sub-issues by number
  for (const expSub of expected.subIssues) {
    const actSub = actual.subIssues.find((s) => s.number === expSub.number);
    if (!actSub) {
      diffs.push({
        path: `subIssues[${expSub.number}]`,
        expected: expSub.number,
        actual: null,
        comparison: "exact",
      });
      continue;
    }
    diffs.push(
      ...compareSubIssue(`subIssues[${expSub.number}]`, expSub, actSub),
    );
  }

  return diffs;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compare expected state trees (union) against actual state.
 *
 * Passes if ANY expected outcome matches the actual state.
 * Returns the best match (fewest diffs) for diagnostic purposes.
 */
export function compareStateTree(
  expected: PredictableStateTree[],
  actual: PredictableStateTree,
): VerifyResult {
  if (expected.length === 0) {
    return {
      pass: true,
      matchedOutcomeIndex: null,
      bestMatch: { outcomeIndex: -1, diffs: [] },
    };
  }

  let bestIndex = 0;
  let bestDiffs: FieldDiff[] = [];
  let foundMatch = false;

  for (let i = 0; i < expected.length; i++) {
    const outcome = expected[i];
    if (!outcome) continue;
    const diffs = compareTreeFields(outcome, actual);

    if (diffs.length === 0) {
      return {
        pass: true,
        matchedOutcomeIndex: i,
        bestMatch: { outcomeIndex: i, diffs: [] },
      };
    }

    if (!foundMatch || diffs.length < bestDiffs.length) {
      bestIndex = i;
      bestDiffs = diffs;
      foundMatch = true;
    }
  }

  return {
    pass: false,
    matchedOutcomeIndex: null,
    bestMatch: { outcomeIndex: bestIndex, diffs: bestDiffs },
  };
}
