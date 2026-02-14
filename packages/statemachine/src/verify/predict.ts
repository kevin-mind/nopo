/**
 * Action-Based State Prediction
 *
 * Folds action predictors over pendingActions to produce predicted state trees.
 * Each predictor returns a declarative PredictDiff (or array of diffs for forking),
 * which is applied via applyDiff.
 */

import {
  actions as actionDefs,
  type Action,
} from "../schemas/actions/index.js";
import type { PredictableStateTree } from "./predictable-state.js";
import type { MachineContext } from "../schemas/state.js";
import {
  cloneTree,
  addHistoryEntry,
  successEntry,
  findCurrentSubIssue,
  resolveTarget,
  applyDiff,
  ITER_REBASED,
} from "../schemas/prediction-helpers.js";

const MAX_OUTCOMES = 20;

/**
 * Predict expected state trees by folding action predictors over pending actions.
 *
 * Algorithm:
 * 1. Start with a single cloned tree (history cleared)
 * 2. For each action, apply its predictor to every current outcome (flatMap)
 * 3. Append logRunEnd success history entry to each outcome
 * 4. If createBranch is in actions, add a rebase outcome
 *
 * Returns an array of possible outcome trees (deterministic actions produce 1,
 * AI-dependent actions fork into N).
 */
export function predictFromActions(
  pendingActions: Action[],
  currentTree: PredictableStateTree,
  machineContext: MachineContext,
  options: { finalState: string },
): PredictableStateTree[] {
  // Start with a single cloned tree (history cleared by cloneTree)
  let outcomes: PredictableStateTree[] = [cloneTree(currentTree)];

  // Fold each action's predictor over the current set of outcomes
  for (const action of pendingActions) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Action.type is a string union; narrowing to keyof is safe at runtime
    const def = actionDefs[action.type as keyof typeof actionDefs];
    if (!def) {
      throw new Error(
        `No action definition found for action type "${action.type}"`,
      );
    }

    // Identity actions (no predict function) pass through unchanged
    if (!def.predict) continue;

    outcomes = outcomes.flatMap((tree) => {
      const cloned = cloneTree(tree);
      const issueNumber =
        "issueNumber" in action && typeof action.issueNumber === "number"
          ? action.issueNumber
          : undefined;
      const target = issueNumber
        ? resolveTarget(cloned, issueNumber)
        : undefined;
      const ctx = { tree: cloned, machineContext };

      // Non-null: guarded by `if (!def.predict) continue` above
      const result = def.predict!(action, target, ctx);
      const diffs = Array.isArray(result) ? result : [result];

      return diffs.map((diff, i) => {
        const t = i === 0 ? cloned : cloneTree(cloned);
        const tgt =
          i === 0
            ? target
            : issueNumber
              ? resolveTarget(t, issueNumber)
              : undefined;
        applyDiff(t, tgt, diff);
        return t;
      });
    });

    if (outcomes.length > MAX_OUTCOMES) {
      throw new Error(
        `Prediction exceeded maximum ${MAX_OUTCOMES} outcomes ` +
          `(${outcomes.length} after action "${action.type}")`,
      );
    }
  }

  // Derive iteration/phase for the success history entry
  const iteration = machineContext.issue.iteration;
  const sub = findCurrentSubIssue(
    { issue: currentTree.issue, subIssues: currentTree.subIssues },
    machineContext,
  );
  const phase = sub ? `Phase ${machineContext.currentPhase ?? "?"}` : "-";

  // Append logRunEnd success entry to each outcome
  const successAction = successEntry(options.finalState);
  for (const tree of outcomes) {
    addHistoryEntry(tree.issue, {
      iteration,
      phase,
      action: successAction,
    });
  }

  // If createBranch is in the actions, add a rebase-only outcome
  // (the branch might already exist → runner just rebases)
  const hasCreateBranch = pendingActions.some((a) => a.type === "createBranch");
  if (hasCreateBranch) {
    const rebaseTree = cloneTree(currentTree);
    addHistoryEntry(rebaseTree.issue, {
      iteration,
      phase,
      action: ITER_REBASED,
    });
    outcomes.push(rebaseTree);
  }

  return outcomes;
}
