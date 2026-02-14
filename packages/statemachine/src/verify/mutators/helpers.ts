/**
 * Re-export prediction helpers from schemas/ layer.
 *
 * This shim keeps existing mutator files working without import changes.
 * The actual helpers live in schemas/prediction-helpers.ts so that
 * actions.ts can import them without cross-layer dependencies.
 */
export {
  cloneTree,
  findCurrentSubIssue,
  addHistoryEntry,
  successEntry,
  ITER_OPENED_PR,
  ITER_UPDATED_PR,
  ITER_FIXED_CI,
  ITER_REBASED,
} from "../../schemas/prediction-helpers.js";
