/**
 * Generic diff comparison helpers.
 *
 * Reusable primitives for comparing expected vs actual field values.
 */

import type { FieldDiff } from "./types.js";

export function diffExact(
  path: string,
  expected: unknown,
  actual: unknown,
): FieldDiff | null {
  if (expected === actual) return null;
  return { path, expected, actual, comparison: "exact" };
}

export function diffGte(
  path: string,
  expected: number,
  actual: number,
): FieldDiff | null {
  if (actual >= expected) return null;
  return { path, expected, actual, comparison: "gte" };
}

export function diffLte(
  path: string,
  expected: number,
  actual: number,
): FieldDiff | null {
  if (actual <= expected) return null;
  return { path, expected, actual, comparison: "lte" };
}

/**
 * Check that expected values are a subset of actual values.
 */
export function diffSuperset(
  path: string,
  expected: string[],
  actual: string[],
): FieldDiff | null {
  const missing = expected.filter((e) => !actual.includes(e));
  if (missing.length === 0) return null;
  return { path, expected: missing, actual, comparison: "superset" };
}

/**
 * Check boolean flag: if expected is true, actual must be true.
 * If expected is false, we don't enforce (might have been set by other actions).
 */
export function diffBooleanFlag(
  path: string,
  expected: boolean,
  actual: boolean,
): FieldDiff | null {
  if (expected && !actual) {
    return { path, expected, actual, comparison: "exact" };
  }
  return null;
}

interface HistoryEntryLike {
  iteration: number;
  phase: string;
  action: string;
}

/**
 * Check that expected history entries are present in actual.
 * Match by (iteration, phase, actionPrefix).
 */
export function diffHistoryEntries(
  path: string,
  expected: HistoryEntryLike[],
  actual: HistoryEntryLike[],
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const exp of expected) {
    const found = actual.some(
      (act) =>
        act.iteration === exp.iteration &&
        act.phase === exp.phase &&
        act.action.startsWith(exp.action),
    );
    if (!found) {
      diffs.push({
        path: `${path}[iter=${exp.iteration},phase=${exp.phase}]`,
        expected: exp.action,
        actual: actual.map((a) => a.action),
        comparison: "history_entry",
      });
    }
  }
  return diffs;
}
