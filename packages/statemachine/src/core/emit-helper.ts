/**
 * Emit helper - reduces boilerplate for XState actions that accumulate into pendingActions.
 *
 * Instead of:
 *   assign({ pendingActions: ({ context }) => accumulateActions(context.pendingActions, emitX({ context })) })
 *
 * Use:
 *   emit(emitX)
 *
 * For emitters that need extra args (e.g. emitLog with message):
 *   emit((ctx) => emitLog(ctx, "message"))
 */

import { assign } from "xstate";
import type { AnyEventObject, EventObject } from "xstate";
import type { MachineContext } from "./schemas.js";
import type { ActionContext, BaseMachineContext } from "./types.js";

type MachineContextWithActions = MachineContext & BaseMachineContext;

/**
 * Accumulate new actions from an emitter into existing actions.
 * Exported for testing.
 */
export function accumulateFromEmitter<TContext extends BaseMachineContext>(
  existingActions: TContext["pendingActions"],
  context: TContext,
  emitter: (ctx: { context: TContext }) => TContext["pendingActions"],
): TContext["pendingActions"] {
  return [...existingActions, ...emitter({ context })];
}

/**
 * Creates an XState assign action that accumulates emitter output into pendingActions.
 * Pass TEvent to match the machine's event type for setup compatibility.
 */
export function emit<TEvent extends EventObject = EventObject>(
  emitter: (ctx: ActionContext) => MachineContextWithActions["pendingActions"],
) {
  return assign<
    MachineContextWithActions,
    AnyEventObject,
    undefined,
    TEvent,
    never
  >({
    pendingActions: ({ context }: { context: MachineContextWithActions }) =>
      accumulateFromEmitter(context.pendingActions, context, emitter),
  });
}

/**
 * Create a typed emit function bound to a specific event type.
 * Eliminates repetitive `emit<MyEvent>(...)` generics at each call site.
 *
 * Usage:
 *   const e = createEmitter<IssueMachineEvent>();
 *   // then in actions:
 *   logDetecting: e((ctx) => emitLog(ctx, "Detecting")),
 */
export function createEmitter<TEvent extends EventObject>() {
  return (
    emitter: (
      ctx: ActionContext,
    ) => MachineContextWithActions["pendingActions"],
  ) => emit<TEvent>(emitter);
}
