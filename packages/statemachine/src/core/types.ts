/**
 * Shared types used by all machines.
 */

import type { MachineContext, Action } from "./schemas.js";

/** Base context shared by all machines — provides pending action accumulation. */
export interface BaseMachineContext {
  pendingActions: Action[];
}

/**
 * Action context type for emitter functions.
 * Wraps the machine context in an object matching XState's action parameter shape.
 */
export interface ActionContext {
  context: MachineContext;
}

/** Logger interface for machine diagnostic output. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

/** Default logger that writes to console. */
export const consoleLogger: Logger = {
  debug: (m) => console.debug(m),
  info: (m) => console.info(m),
  warning: (m) => console.warn(m),
  error: (m) => console.error(m),
};
