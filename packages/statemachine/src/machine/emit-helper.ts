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
import type { MachineContext, Action } from "../schemas/index.js";

/**
 * Action context type for emitter functions
 */
interface ActionContext {
  context: MachineContext;
}

/**
 * Accumulate new actions from an emitter into existing actions.
 * Exported for testing.
 */
export function accumulateFromEmitter(
  existingActions: Action[],
  context: MachineContext,
  emitter: (ctx: ActionContext) => Action[],
): Action[] {
  return [...existingActions, ...emitter({ context })];
}

type PendingContext = MachineContext & { pendingActions: Action[] };

/**
 * Creates an XState assign action that accumulates emitter output into pendingActions.
 * Pass TEvent to match the machine's event type for setup compatibility.
 */
export function emit<TEvent extends EventObject = EventObject>(
  emitter: (ctx: ActionContext) => Action[],
) {
  return assign<PendingContext, AnyEventObject, undefined, TEvent, never>({
    pendingActions: ({ context }: { context: PendingContext }) =>
      accumulateFromEmitter(context.pendingActions, context, emitter),
  });
}
