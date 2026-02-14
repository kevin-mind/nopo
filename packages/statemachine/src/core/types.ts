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

/** Valid log level strings that map to Logger methods. */
const LOG_LEVELS = new Set(["debug", "info", "warning", "error"]);

/** Route a `{ type: "log" }` action to the appropriate logger method. */
export function routeLogAction(action: Action, logger: Logger): void {
  const rawLevel =
    "level" in action && typeof action.level === "string"
      ? action.level
      : "info";
  const level = LOG_LEVELS.has(rawLevel) ? rawLevel : "info";
  const message =
    "message" in action && typeof action.message === "string"
      ? action.message
      : "unknown";
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- level is validated above
  (logger[level as keyof Logger] as (m: string) => void)(message);
}
