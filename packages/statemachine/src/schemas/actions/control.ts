/**
 * Control Flow Actions
 *
 * stop, log, noop — simple actions that don't call external APIs.
 */

import { z } from "zod";
import * as core from "@actions/core";
import { mkSchema, defAction } from "./_shared.js";

// ============================================================================
// Control Flow Actions
// ============================================================================

export const controlActions = {
  /** Stop execution with a message */
  stop: defAction(
    mkSchema("stop", {
      message: z.string().min(1),
    }),
    {
      execute: (action) => {
        core.info(`Stopping: ${action.message}`);
        return Promise.resolve({ stopped: true, reason: action.message });
      },
    },
  ),

  /** Log a message (no-op, for debugging) */
  log: defAction(
    mkSchema("log", {
      message: z.string(),
      level: z.enum(["debug", "info", "warning", "error"]).default("info"),
      worktree: z.string().optional(),
    }),
    {
      execute: (action) => {
        switch (action.level) {
          case "debug":
            core.debug(action.message);
            break;
          case "warning":
            core.warning(action.message);
            break;
          case "error":
            core.error(action.message);
            break;
          default:
            core.info(action.message);
        }
        return Promise.resolve({ logged: true });
      },
    },
  ),

  /** No-op action (do nothing) */
  noop: defAction(
    mkSchema("noop", {
      message: z.string().min(1).optional(),
    }),
    {
      execute: (action) => {
        core.debug(`No-op: ${action.message || "no reason given"}`);
        return Promise.resolve({ noop: true });
      },
    },
  ),
};
