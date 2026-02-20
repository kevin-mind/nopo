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

export type TActionInput<
  TType extends string = string,
  TPayload extends TBasePayload = TBasePayload,
> = {
  type: TType;
  payload: TPayload;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- wildcard for constraint bounds
export type TActionDefs<TDomain = any, TServices = any> = Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wildcard for constraint bounds
  TAction<TDomain, any, any, TServices>
>;

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
