/**
 * Types for the action registry.
 *
 * ActionExecutorMap is a mapped type that preserves the per-key relationship
 * between action type and executor parameter. This lets direct executor
 * assignments work without wrapping, and contextual typing gives inline
 * handlers the narrowed action type automatically.
 *
 * dispatchAction bridges the "correlated union" gap at the call site:
 * we know action.type matches the registry key, but TS can't prove it
 * across the generic lookup.
 */

import type { Action } from "../schemas/actions.js";
import type { RunnerContext, ActionChainContext } from "./types.js";

/**
 * Mapped type: each action type key maps to an executor expecting that
 * specific action variant. Direct executor functions satisfy this naturally,
 * and inline handlers get the narrowed type via contextual typing.
 *
 * Keyed by Action["type"] (string literals) rather than the ActionType enum,
 * because Extract needs the same string literal types the schemas produce.
 */
export type ActionExecutorMap = {
  [T in Action["type"]]: (
    action: Extract<Action, { type: T }>,
    ctx: RunnerContext,
    chainCtx?: ActionChainContext,
  ) => Promise<unknown>;
};

/**
 * Dispatch an action through the registry.
 * The mapped type ensures each key has the correct executor, but TS cannot
 * correlate the dynamic lookup. This helper encapsulates that single gap.
 */
export function dispatchAction(
  registry: ActionExecutorMap,
  action: Action,
  ctx: RunnerContext,
  chainCtx?: ActionChainContext,
): Promise<unknown> {
  type Fn = (
    action: Action,
    ctx: RunnerContext,
    chainCtx?: ActionChainContext,
  ) => Promise<unknown>;
  // Safe: registry[action.type] is the executor for this specific action.type.
  // TS can't prove this across a generic index, but the mapped type guarantees it.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- correlated union dispatch
  const executor = registry[action.type] as Fn;
  return executor(action, ctx, chainCtx);
}
