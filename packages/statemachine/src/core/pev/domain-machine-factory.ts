/**
 * Domain Machine Factory
 *
 * Stateful, single-level builder for domain machine config using the approved
 * factory API shape.
 */

import type {
  DomainMachineConfig,
  ExternalRunnerContext,
  RunnerMachineContext,
} from "./types.js";
import { createDomainMachine } from "./domain-machine.js";
import type { EventObject } from "xstate";
import {
  createActionRegistry,
  type TActionDefs,
  type TActionRegistryFromDefs,
  type TRegistryBuilder,
  type ActionFromRegistry,
} from "./action-registry.js";

type RefreshContextFn<TDomain> = (
  runnerCtx: ExternalRunnerContext,
  current: TDomain,
) => Promise<TDomain>;

type TGuardFn<TDomain, TAction extends { type: string }> = (args: {
  context: RunnerMachineContext<TDomain, TAction>;
}) => boolean;

type TGuardsMap<TDomain, TAction extends { type: string }> = Record<
  string,
  TGuardFn<TDomain, TAction>
>;

type ActionFromMaybeRegistry<TRegistry> =
  TRegistry extends TActionRegistryFromDefs<TActionDefs>
    ? ActionFromRegistry<TRegistry>
    : { type: string };
type EffectiveAction<
  TRegistry,
  TActionOverride extends { type: string } | undefined,
> = TActionOverride extends { type: string }
  ? TActionOverride
  : ActionFromMaybeRegistry<TRegistry>;

type StatesBuilder<TRegistry> = (args: {
  registry: TRegistry;
}) => Record<string, unknown>;

type BuiltDomainMachine<
  TDomain,
  TAction extends { type: string },
  TEvent extends EventObject = EventObject,
> = ReturnType<typeof createDomainMachine<TDomain, TAction, TEvent>>;

interface MachineFactory<
  TDomain,
  TRegistry = undefined,
  TActionOverride extends { type: string } | undefined = undefined,
  TFactoryEvent extends EventObject = EventObject,
> {
  actions(): TRegistry;
  actions<const TDefs extends TActionDefs<TDomain>>(
    build: TRegistryBuilder<TDomain, TDefs>,
  ): MachineFactory<
    TDomain,
    TActionRegistryFromDefs<TDefs>,
    TActionOverride,
    TFactoryEvent
  >;

  guards():
    | TGuardsMap<TDomain, EffectiveAction<TRegistry, TActionOverride>>
    | undefined;
  guards<
    const TGuards extends TGuardsMap<
      TDomain,
      EffectiveAction<TRegistry, TActionOverride>
    >,
  >(
    build: () => TGuards,
  ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;

  states(): Record<string, unknown>;
  states(
    s: Record<string, unknown>,
  ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;
  states(
    build: TRegistry extends undefined
      ? never
      : StatesBuilder<NonNullable<TRegistry>>,
  ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;

  refreshContext(): RefreshContextFn<TDomain> | undefined;
  refreshContext(
    fn: RefreshContextFn<TDomain>,
  ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;

  build<TEvent extends EventObject = TFactoryEvent>(
    opts:
      | { id: string }
      | {
          id: string;
          domainStates: Record<string, unknown>;
          actionRegistry: TActionRegistryFromDefs<TActionDefs>;
          guards: TGuardsMap<TDomain, { type: string }>;
          refreshContext: RefreshContextFn<TDomain>;
        },
  ): BuiltDomainMachine<
    TDomain,
    EffectiveAction<TRegistry, TActionOverride>,
    TEvent
  >;
}

interface RuntimeFactoryState<
  TDomain,
  TRegistry,
  TActionOverride extends { type: string } | undefined,
> {
  registry: TRegistry;
  guards:
    | TGuardsMap<TDomain, EffectiveAction<TRegistry, TActionOverride>>
    | undefined;
  domainStates: Record<string, unknown>;
  domainStatesBuilder: StatesBuilder<NonNullable<TRegistry>> | undefined;
  refreshContext: RefreshContextFn<TDomain> | undefined;
}

export function createMachineFactory<
  TDomain,
  TActionOverride extends { type: string } | undefined = undefined,
  TFactoryEvent extends EventObject = EventObject,
>(): MachineFactory<TDomain, undefined, TActionOverride, TFactoryEvent> {
  function buildFactory<TRegistry>(
    state: RuntimeFactoryState<TDomain, TRegistry, TActionOverride>,
  ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent> {
    function actions(): TRegistry;
    function actions<const TDefs extends TActionDefs<TDomain>>(
      build: TRegistryBuilder<TDomain, TDefs>,
    ): MachineFactory<
      TDomain,
      TActionRegistryFromDefs<TDefs>,
      TActionOverride,
      TFactoryEvent
    >;
    function actions(build?: TRegistryBuilder<TDomain, TActionDefs<TDomain>>) {
      if (build === undefined) {
        return state.registry;
      }
      const nextRegistry = createActionRegistry(build);
      const nextState: RuntimeFactoryState<
        TDomain,
        TActionRegistryFromDefs<TActionDefs<TDomain>>,
        TActionOverride
      > = {
        ...state,
        registry: nextRegistry,
        // Guards are action-aware; clear when actions are replaced.
        guards: undefined,
        // States builders are registry-aware; clear when actions are replaced.
        domainStatesBuilder: undefined,
      };
      return buildFactory<TActionRegistryFromDefs<TActionDefs<TDomain>>>(
        nextState,
      );
    }

    function guards():
      | TGuardsMap<TDomain, EffectiveAction<TRegistry, TActionOverride>>
      | undefined;
    function guards<
      const TGuards extends TGuardsMap<
        TDomain,
        EffectiveAction<TRegistry, TActionOverride>
      >,
    >(
      build: () => TGuards,
    ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;
    function guards(
      build?: () => TGuardsMap<
        TDomain,
        EffectiveAction<TRegistry, TActionOverride>
      >,
    ) {
      if (build === undefined) {
        return state.guards;
      }
      const nextState: RuntimeFactoryState<
        TDomain,
        TRegistry,
        TActionOverride
      > = {
        ...state,
        guards: build(),
      };
      return buildFactory<TRegistry>(nextState);
    }

    function states(): Record<string, unknown>;
    function states(
      s: Record<string, unknown>,
    ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;
    function states(
      build: TRegistry extends undefined
        ? never
        : StatesBuilder<NonNullable<TRegistry>>,
    ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;
    function states(
      s?: Record<string, unknown> | StatesBuilder<NonNullable<TRegistry>>,
    ) {
      if (s === undefined) {
        return state.domainStates;
      }
      if (typeof s === "function") {
        const nextState: RuntimeFactoryState<
          TDomain,
          TRegistry,
          TActionOverride
        > = {
          ...state,
          domainStatesBuilder: s,
        };
        return buildFactory<TRegistry>(nextState);
      }
      const nextState: RuntimeFactoryState<
        TDomain,
        TRegistry,
        TActionOverride
      > = {
        ...state,
        domainStates: s,
        domainStatesBuilder: undefined,
      };
      return buildFactory<TRegistry>(nextState);
    }

    function refreshContext(): RefreshContextFn<TDomain> | undefined;
    function refreshContext(
      fn: RefreshContextFn<TDomain>,
    ): MachineFactory<TDomain, TRegistry, TActionOverride, TFactoryEvent>;
    function refreshContext(fn?: RefreshContextFn<TDomain>) {
      if (fn === undefined) {
        return state.refreshContext;
      }
      const nextState: RuntimeFactoryState<
        TDomain,
        TRegistry,
        TActionOverride
      > = {
        ...state,
        refreshContext: fn,
      };
      return buildFactory<TRegistry>(nextState);
    }

    function build<TEvent extends EventObject = TFactoryEvent>(
      opts:
        | { id: string }
        | {
            id: string;
            domainStates: Record<string, unknown>;
            actionRegistry: TActionRegistryFromDefs<TActionDefs>;
            guards: TGuardsMap<TDomain, { type: string }>;
            refreshContext: RefreshContextFn<TDomain>;
          },
    ): BuiltDomainMachine<
      TDomain,
      EffectiveAction<TRegistry, TActionOverride>,
      TEvent
    > {
      const usingStoredParts = !(
        "actionRegistry" in opts && opts.actionRegistry != null
      );
      if (usingStoredParts) {
        const actionRegistry = state.registry;
        const guards = state.guards;
        const refreshContext = state.refreshContext;
        if (!actionRegistry || !guards || !refreshContext) {
          throw new Error(
            "Machine factory not fully configured. Call .actions(), .guards(), and .refreshContext() before .build().",
          );
        }
        const domainStates = state.domainStatesBuilder
          ? state.domainStatesBuilder({ registry: actionRegistry })
          : state.domainStates;
        const machineConfig: DomainMachineConfig<
          TDomain,
          EffectiveAction<TRegistry, TActionOverride>,
          TEvent
        > = {
          id: opts.id,
          domainStates,
          actionRegistry,
          guards,
          refreshContext,
        };
        return createDomainMachine<
          TDomain,
          EffectiveAction<TRegistry, TActionOverride>,
          TEvent
        >(machineConfig);
      }

      const machineConfig: DomainMachineConfig<
        TDomain,
        EffectiveAction<TRegistry, TActionOverride>,
        TEvent
      > = {
        id: opts.id,
        domainStates: opts.domainStates,
        actionRegistry: opts.actionRegistry,
        guards: opts.guards,
        refreshContext: opts.refreshContext,
      };
      return createDomainMachine<
        TDomain,
        EffectiveAction<TRegistry, TActionOverride>,
        TEvent
      >(machineConfig);
    }

    return {
      actions,
      guards,
      states,
      refreshContext,
      build,
    };
  }

  return buildFactory({
    registry: undefined,
    guards: undefined,
    domainStates: {},
    domainStatesBuilder: undefined,
    refreshContext: undefined,
  });
}
