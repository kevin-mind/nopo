/**
 * Verification module.
 *
 * Provides prediction → execution → verification loop for the state machine.
 */

// Predictable state schemas and extraction
export {
  PredictablePRStateSchema,
  PredictableSubIssueStateSchema,
  PredictableIssueStateSchema,
  PredictableStateTreeSchema,
  ExpectedStateSchema,
  extractPredictableTree,
  buildExpectedState,
  type PredictablePRState,
  type PredictableSubIssueState,
  type PredictableIssueState,
  type PredictableStateTree,
  type ExpectedState,
} from "./predictable-state.js";

// Mutators
export { getMutator, hasMutator, type StateMutator } from "./mutators/index.js";

// Action-based prediction
export { predictFromActions } from "./predict.js";

// Comparison engine
export {
  compareStateTree,
  compareTreeFields,
  type VerifyResult,
  type FieldDiff,
} from "./compare.js";
