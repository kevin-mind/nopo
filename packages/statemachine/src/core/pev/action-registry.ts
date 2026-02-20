/**
 * Action Registry API
 *
 * Defines action input/action definition types plus helpers to build a typed
 * action registry from a factory callback.
 */

import type {
  PredictResult,
  PevVerifyReturn,
  VerifyArgs,
  ActionExecuteInput,
} from "./types.js";

type TBasePayload = Record<string, unknown>;

/**
 * Discriminated-union shape for a single dispatchable action.
 *
 * Every action carried through the system is a plain object with a `type`
 * string discriminant and a `payload` record. Narrowing on `type` gives full
 * access to the typed payload.
 *
 * @typeParam TType - String literal used as the discriminant (e.g. `"ADD_LABEL"`).
 * @typeParam TPayload - Record describing the action's payload fields.
 */
export type TActionInput<
  TType extends string = string,
  TPayload extends TBasePayload = TBasePayload,
> = {
  type: TType;
  payload: TPayload;
};

/**
 * Upper-bound constraint for a map of action definitions.
 *
 * Use this type as a generic constraint (e.g. `TDefs extends TActionDefs`)
 * when you need to accept any valid set of action definitions without fixing
 * the domain or services types. The `any` defaults act as wildcards so all
 * concrete registries satisfy the constraint.
 *
 * @typeParam TDomain - Domain context type (defaults to `any` for constraint use).
 * @typeParam TServices - External services type (defaults to `any` for constraint use).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- wildcard for constraint bounds
export type TActionDefs<TDomain = any, TServices = any> = Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wildcard for constraint bounds
  TAction<TDomain, any, any, TServices>
>;

/**
 * Handler shape for a single action type in the PEV (Predict-Execute-Verify) pipeline.
 *
 * Implement this interface to define what an action does at each phase:
 * - `description` — human-readable label for logging (static string or derived from context)
 * - `predict` — declare expected postconditions before executing (optional)
 * - `execute` — perform the action's side effects (required)
 * - `verify` — confirm postconditions after executing (optional; defaults to pass)
 *
 * @typeParam TDomain - Domain context object passed to predict, execute, and verify.
 * @typeParam TPayload - Record type for the action's payload fields.
 * @typeParam TType - String literal discriminant identifying the action type.
 * @typeParam TServices - External services injected into `execute` (e.g. API clients).
 */
export interface TAction<
  TDomain,
  TPayload extends TBasePayload,
  TType extends string = string,
  TServices = unknown,
> {
  description?:
    | string
    | ((action: TActionInput<TType, TPayload>, ctx: TDomain) => string);
  predict?: (
    action: TActionInput<TType, TPayload>,
    ctx: TDomain,
  ) => PredictResult;
  execute: (
    input: ActionExecuteInput<
      TActionInput<TType, TPayload>,
      TDomain,
      TServices
    >,
  ) => Promise<unknown>;
  verify?: (
    args: VerifyArgs<TActionInput<TType, TPayload>, TDomain>,
  ) => PevVerifyReturn;
}

type InferPayload<T> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inference helper
  T extends TAction<any, infer TPayload, any, any> ? TPayload : never;

type InferDomain<T> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inference helper
  T extends TAction<infer TDomain, any, any, any> ? TDomain : never;

type InferServices<T> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inference helper
  T extends TAction<any, any, any, infer S> ? S : unknown;

/**
 * A fully-built action entry in the registry.
 *
 * Extends {@link TAction} with two additional fields added by
 * `createRegistryEntry`:
 * - `type` — the string discriminant key bound to `TType`, used to look up the
 *   entry at runtime.
 * - `create` — a typed factory helper that constructs a `TActionInput` for this
 *   action without having to repeat the `type` string at call sites.
 *
 * @typeParam TType - String literal discriminant (e.g. `"ADD_LABEL"`).
 * @typeParam TDomain - Domain context type passed through to the underlying `TAction`.
 * @typeParam TPayload - Payload record type for this action.
 * @typeParam TServices - External services type passed through to the underlying `TAction`.
 */
export type RegistryEntry<
  TType extends string,
  TDomain,
  TPayload extends TBasePayload,
  TServices = unknown,
> = TAction<TDomain, TPayload, TType, TServices> & {
  type: TType;
  create: (payload: TPayload) => TActionInput<TType, TPayload>;
};

export type TActionRegistryFromDefs<TDefs extends TActionDefs> = {
  [K in keyof TDefs & string]: RegistryEntry<
    K,
    InferDomain<TDefs[K]>,
    InferPayload<TDefs[K]>,
    InferServices<TDefs[K]>
  >;
};

/**
 * Extracts the union of all dispatchable {@link TActionInput} types from a built registry.
 *
 * Iterates every key `K` of the registry `R` and, if the entry is a
 * `RegistryEntry`, produces the corresponding `TActionInput<K, P>`. The final
 * indexed access collapses the mapped type into a discriminated union — ideal
 * for typing dispatch parameters or exhaustive switch statements.
 *
 * @example
 * ```ts
 * type MyAction = ActionFromRegistry<typeof myRegistry>;
 * // MyAction = TActionInput<"ADD_LABEL", { name: string }>
 * //           | TActionInput<"CLOSE_ISSUE", { reason: string }>
 * //           | ...
 * ```
 *
 * @typeParam R - A built registry type (e.g. `TActionRegistryFromDefs<TDefs>`).
 */
export type ActionFromRegistry<R> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `any` needed to match RegistryEntry with any domain type
  [K in keyof R & string]: R[K] extends RegistryEntry<K, any, infer P, any>
    ? TActionInput<K, P>
    : never;
}[keyof R & string];

export type TCreateActionForDomain<TDomain, TServices = unknown> = <
  TPayload extends TBasePayload = TBasePayload,
>(
  action: TAction<TDomain, TPayload, string, TServices>,
) => TAction<TDomain, TPayload, string, TServices>;

export type TRegistryBuilder<
  TDomain,
  TDefs extends TActionDefs<TDomain>,
  TServices = unknown,
> = (createAction: TCreateActionForDomain<TDomain, TServices>) => TDefs;

function createRegistryEntry<
  const TDefs extends TActionDefs,
  const TType extends keyof TDefs & string,
>(defs: TDefs, type: TType): TActionRegistryFromDefs<TDefs>[TType] {
  const def = defs[type];
  return {
    ...def,
    type,
    create: (payload: InferPayload<TDefs[TType]>) => ({ type, payload }),
  };
}

function mapRegistry<const TDefs extends TActionDefs>(
  defs: TDefs,
): TActionRegistryFromDefs<TDefs> {
  const registry: Partial<TActionRegistryFromDefs<TDefs>> = {};
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Object.keys returns string[], need to narrow
  for (const key of Object.keys(defs) as Array<keyof TDefs & string>) {
    registry[key] = createRegistryEntry(defs, key);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Partial is fully populated by the loop
  return registry as TActionRegistryFromDefs<TDefs>;
}

/**
 * Factory for building a fully-typed action registry.
 *
 * Accepts a `build` callback that receives a `createAction` helper — a
 * pass-through function that infers the domain and services types from its
 * argument, enabling TypeScript to validate every action definition in context.
 * The callback must return a plain object whose keys become the action type
 * discriminants and whose values are the corresponding {@link TAction}
 * definitions.
 *
 * Internally, each definition is augmented with a `type` discriminant and a
 * `create` factory (see {@link RegistryEntry}), resulting in a
 * `TActionRegistryFromDefs<TDefs>` where every entry is fully typed.
 *
 * @example
 * ```ts
 * const registry = createActionRegistry<MyDomain, MyServices>((createAction) => ({
 *   ADD_LABEL: createAction({
 *     description: "Add a label to the issue",
 *     execute: async ({ action, ctx, services }) => {
 *       await services.octokit.issues.addLabels({ labels: [action.payload.name] });
 *     },
 *   }),
 * }));
 *
 * const input = registry.ADD_LABEL.create({ name: "bug" });
 * // => { type: "ADD_LABEL", payload: { name: "bug" } }
 * ```
 *
 * @typeParam TDomain - Domain context type shared across all action handlers.
 * @typeParam TServices - External services type injected into `execute`.
 * @typeParam TDefs - The concrete action definitions record returned by `build`.
 */
export function createActionRegistry<
  TDomain,
  TServices,
  const TDefs extends TActionDefs<TDomain, TServices>,
>(
  build: TRegistryBuilder<TDomain, TDefs, TServices>,
): TActionRegistryFromDefs<TDefs> {
  const createAction: TCreateActionForDomain<TDomain, TServices> = (action) =>
    action;
  return mapRegistry(build(createAction));
}
