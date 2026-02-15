/**
 * Schema re-exports for machine consumption.
 *
 * Re-exports from src/schemas/ so machines import only from core/.
 * The originals remain for other consumers (runner, verify, test-runner, etc.).
 */

export type { MachineContext } from "./schemas/state.js";
export type { Action } from "./schemas/actions/index.js";
export { actions } from "./schemas/actions/index.js";
export { isTerminalStatus } from "./schemas/entities.js";
