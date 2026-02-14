import type { Action } from "./schemas.js";
import { actions } from "./schemas.js";
import type { ActionContext } from "./types.js";

/** Emit a log action. Level defaults to "info", worktree defaults to "main". */
export function emitLog(
  _ctx: ActionContext,
  message: string,
  level: "debug" | "info" | "warning" | "error" = "info",
): Action[] {
  return [actions.log.create({ level, message, worktree: "main" })];
}
