/**
 * Prediction Helpers
 *
 * Tree manipulation helpers for action predictors.
 * These are used by defineAction() predictors in actions.ts and by
 * the fold algorithm in verify/predict.ts.
 *
 * Moved from verify/mutators/helpers.ts to avoid cross-layer imports
 * (actions.ts is in schemas/, mutators are in verify/).
 */

import type {
  PredictableStateTree,
  PredictableIssueState,
  PredictableSubIssueState,
} from "../../machines/issues/verify/predictable-state.js";
import type { HistoryEntry } from "@more/issue-state";
import type { MachineContext } from "./state.js";
import { getTransitionName } from "../../machines/issues/context.js";

/**
 * Deep-clone a PredictableStateTree for mutation.
 *
 * History entries are cleared so that only entries added by predictors
 * (i.e. predictions for *this* run) end up in the expected tree. The
 * verify comparison checks that each expected entry exists somewhere in
 * the actual (full) history — pre-existing entries are not re-verified.
 */
export function cloneTree(tree: PredictableStateTree): PredictableStateTree {
  const clone = structuredClone(tree);
  clone.issue.body.historyEntries = [];
  for (const sub of clone.subIssues) {
    sub.body.historyEntries = [];
  }
  return clone;
}

/**
 * Find the sub-issue matching the current phase in the tree.
 *
 * When processing a sub-issue directly (e.g., CI completion on the sub-issue),
 * `currentSubIssue` is null because `findCurrentPhase` looks at the issue's
 * own sub-issues (which a sub-issue doesn't have). In this case, the issue
 * itself IS the sub-issue, so we look it up by `context.issue.number`.
 */
export function findCurrentSubIssue(
  tree: PredictableStateTree,
  context: MachineContext,
): PredictableSubIssueState | undefined {
  const subNumber = context.currentSubIssue?.number;
  if (subNumber) {
    return tree.subIssues.find((s) => s.number === subNumber);
  }
  // Processing a sub-issue directly (not through orchestration)
  if (context.parentIssue) {
    return tree.subIssues.find((s) => s.number === context.issue.number);
  }
  return undefined;
}

/**
 * Add a history entry to the issue's body structure.
 */
export function addHistoryEntry(
  issue: PredictableIssueState,
  entry: Pick<HistoryEntry, "iteration" | "phase" | "action">,
): void {
  issue.body.historyEntries.push({
    iteration: entry.iteration,
    phase: entry.phase,
    action: entry.action,
    timestamp: null,
    sha: null,
    runLink: null,
  });
}

/**
 * Generate the success history entry for a given state name.
 * Matches the `checkmark {transitionName}` format that logRunEnd writes on success.
 */
export function successEntry(stateName: string): string {
  return `\u2705 ${getTransitionName(stateName)}`;
}

/**
 * Resolve an issue number to the corresponding predictable state node.
 *
 * Returns the issue (root) state if the number matches the root, or the
 * matching sub-issue state. Returns undefined if no match.
 */
export function resolveTarget(
  tree: PredictableStateTree,
  issueNumber: number,
): PredictableIssueState | PredictableSubIssueState | undefined {
  if (tree.issue.number === issueNumber) {
    return tree.issue;
  }
  return tree.subIssues.find((s) => s.number === issueNumber);
}

// ============================================================================
// Diff Application (for declarative predict API)
// ============================================================================

/**
 * Deep-merge a partial diff into a target object.
 *
 * Rules at each key:
 * - If existing value is an array AND diff has `add`/`remove` keys → apply array op
 * - If both are plain objects → recurse
 * - Otherwise → overwrite (primitives, null, complete arrays)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- operating on loosely-typed diff objects
function deepMerge(obj: any, partial: any): void {
  for (const [key, value] of Object.entries(partial)) {
    const existing = obj[key];

    // Array operation: existing is array AND diff is { add?, remove? }
    if (
      Array.isArray(existing) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ("add" in value || "remove" in value)
    ) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed by guard above
      const op = value as { add?: unknown[]; remove?: unknown[] };
      if (op.remove) {
        const removeSet = new Set(op.remove);
        obj[key] = existing.filter((x: unknown) => !removeSet.has(x));
      }
      if (op.add) {
        for (const item of op.add) {
          if (!obj[key].includes(item)) {
            obj[key].push(item);
          }
        }
      }
      continue;
    }

    // Both plain objects → recurse
    if (
      existing !== null &&
      existing !== undefined &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      deepMerge(existing, value);
      continue;
    }

    // Primitive overwrite (or null/undefined → set directly)
    obj[key] = value;
  }
}

/**
 * Apply a PredictDiff to a state tree.
 *
 * - `diff.target` → deep-merge into the resolved target
 * - `diff.issue` → deep-merge into tree.issue
 * - `diff.subs` → for each, find matching sub-issue by number and deep-merge
 */
export function applyDiff(
  tree: PredictableStateTree,
  target: PredictableIssueState | PredictableSubIssueState | undefined,

  diff: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed diff
    target?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed diff
    issue?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed diff
    subs?: Array<{ number: number } & Record<string, any>>;
  },
): void {
  if (diff.target && target) {
    deepMerge(target, diff.target);
  }
  if (diff.issue) {
    deepMerge(tree.issue, diff.issue);
  }
  if (diff.subs) {
    for (const subDiff of diff.subs) {
      const sub = tree.subIssues.find((s) => s.number === subDiff.number);
      if (sub) {
        const { number: _, ...rest } = subDiff;
        deepMerge(sub, rest);
      }
    }
  }
}

// ============================================================================
// Iteration History Constants
// ============================================================================

/** Predict opened-PR outcome */
export const ITER_OPENED_PR = "\u2705 Opened PR";
/** Predict updated-PR outcome */
export const ITER_UPDATED_PR = "\u2705 Updated PR";
/** Predict fixed-CI outcome */
export const ITER_FIXED_CI = "\uD83D\uDD27 Fixed CI";
/** Predict rebase outcome */
export const ITER_REBASED = "\uD83D\uDD04 Rebased";
