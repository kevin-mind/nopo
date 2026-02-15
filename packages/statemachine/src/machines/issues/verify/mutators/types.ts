/**
 * Shared types for state mutators.
 */

import type { MachineContext } from "../../../../core/schemas/state.js";
import type { PredictableStateTree } from "../predictable-state.js";

/**
 * A StateMutator takes the current predicted state tree and machine context,
 * and returns an array of possible outcome trees.
 *
 * Deterministic states return exactly 1 outcome.
 * AI-dependent states return N outcomes (the actual must match ANY).
 */
export type StateMutator = (
  current: PredictableStateTree,
  context: MachineContext,
) => PredictableStateTree[];
