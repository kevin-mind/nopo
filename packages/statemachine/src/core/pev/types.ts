/**
 * PEV (Predict-Execute-Verify) Machine Types
 *
 * Defines the interfaces that domain machines must implement to plug into
 * the shared predict-execute-verify runner infrastructure.
 */

import type { EventObject } from "xstate";

// ============================================================================
// Action Registry Types
// ============================================================================

type CheckSource = "old" | "new";

type PredictionLeafCheck =
  | {
      comparator: "eq";
      description?: string;
      field: string;
      expected: unknown;
      from?: CheckSource;
    }
  | {
      comparator: "gte";
      description?: string;
      field: string;
      expected: number;
      from?: CheckSource;
    }
  | {
      comparator: "lte";
      description?: string;
      field: string;
      expected: number;
      from?: CheckSource;
    }
  | {
      comparator: "subset";
      description?: string;
      field: string;
      expected: unknown[];
      from?: CheckSource;
    }
  | {
      comparator: "includes";
      description?: string;
      field: string;
      expected: unknown;
      from?: CheckSource;
    }
  | {
      comparator: "exists";
      description?: string;
      field: string;
      from?: CheckSource;
    }
  | {
      comparator: "startsWith";
      description?: string;
      field: string;
      expected: string;
      from?: CheckSource;
    };

type PredictionGroupCheck =
  | {
      comparator: "all";
      description?: string;
      checks: PredictionCheck[];
    }
  | {
      comparator: "any";
      description?: string;
      checks: PredictionCheck[];
    };

export type PredictionCheck = PredictionLeafCheck | PredictionGroupCheck;

export interface PredictionCheckDiff {
  description?: string;
  field: string;
  comparator: PredictionCheck["comparator"];
  expected: unknown;
  actual: unknown;
}

export interface PredictionCheckResult {
  pass: boolean;
  diffs: PredictionCheckDiff[];
}

/**
 * Result of running an action's predict phase.
 * Predictions describe what the action WILL do, before executing.
 */
export interface PredictResult {
  /** Human-readable description of predicted effect */
  description?: string;
  /** Declarative postconditions to enforce during verify */
  checks?: PredictionCheck[];
}

/**
 * Result of running an action's verify phase.
 * Verifications check whether the action DID what it predicted.
 */
export interface PevVerifyResult {
  /** Whether verification passed */
  pass: boolean;
  /** Human-readable message explaining the result */
  message: string;
  /** Diffs between expected and actual state */
  diffs?: Array<{ field: string; expected: unknown; actual: unknown }>;
}

/**
 * Failure-only verify return for ergonomic custom verify functions.
 * Returning this object indicates verification failure.
 */
interface PevVerifyFailure {
  message: string;
  diffs?: Array<{ field: string; expected: unknown; actual: unknown }>;
}

/**
 * Custom verify may:
 * - return void/null/undefined for pass
 * - return PevVerifyFailure for fail
 * - return full PevVerifyResult (explicit mode)
 */
export type PevVerifyReturn = PevVerifyResult | PevVerifyFailure | void | null;

export interface VerifyArgs<TAction = unknown, TDomainContext = unknown> {
  action: TAction;
  oldCtx: TDomainContext;
  newCtx: TDomainContext;
  prediction: PredictResult | null;
  predictionEval: PredictionCheckResult;
  predictionDiffs: PredictionCheckDiff[];
  executeResult: unknown;
}

/**
 * Definition for a single action type in the registry.
 * Domain machines provide these to describe their executable actions.
 */
export interface ActionExecuteInput<
  TAction = unknown,
  TDomainContext = unknown,
  TServices = unknown,
> {
  action: TAction;
  ctx: TDomainContext;
  services: TServices;
}

export interface ActionDefinition<TAction = unknown, TDomainContext = unknown> {
  /** Human-readable action description used by the runner logger */
  description?: string | ((action: TAction, context: TDomainContext) => string);
  /** Predict what this action will do (optional — defaults to no prediction) */
  predict?: (action: TAction, context: TDomainContext) => PredictResult;
  /** Execute the action's side effects */
  execute: (
    input: ActionExecuteInput<TAction, TDomainContext>,
  ) => Promise<unknown>;
  /** Verify the action's effects after execution (optional — defaults to pass) */
  verify?: (args: VerifyArgs<TAction, TDomainContext>) => PevVerifyReturn;
}

/**
 * Registry of action definitions keyed by action type string.
 */
export type ActionRegistry<
  TAction = unknown,
  TDomainContext = unknown,
> = Record<string, ActionDefinition<TAction, TDomainContext>>;

// ============================================================================
// Runner Context Types
// ============================================================================

/**
 * External runner context injected at machine creation.
 * Contains I/O handles like octokit, tokens, etc.
 */
export interface ExternalRunnerContext {
  /** GitHub token for API calls */
  token: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Any additional properties the domain needs */
  [key: string]: unknown;
}

/**
 * The full context managed by a PEV machine.
 * Combines domain-specific context with runner bookkeeping.
 */
export interface RunnerMachineContext<
  TDomainContext = unknown,
  TAction = unknown,
  TServices = unknown,
> {
  /** Domain context — opaque to the runner, managed by domain machine */
  domain: TDomainContext;

  /** Injected services — opaque to the runner, passed through to action execute */
  services: TServices;

  /** Queue of actions to execute */
  actionQueue: TAction[];
  /** Currently executing action */
  currentAction: TAction | null;
  /** Prediction for current action */
  prediction: PredictResult | null;
  /** Snapshot of domain context before current action executed */
  preActionSnapshot: TDomainContext | null;
  /** Result of executing current action */
  executeResult: unknown;
  /** Result of verifying current action */
  verifyResult: PevVerifyResult | null;
  /** Log of completed actions */
  completedActions: Array<{
    action: TAction;
    result: unknown;
    verified: boolean;
  }>;
  /** Number of actions executed so far */
  cycleCount: number;
  /** Maximum actions to execute before exiting */
  maxCycles: number;
  /** Error message if execution fails */
  error: string | null;

  /** External runner context (octokit, tokens, etc.) */
  runnerCtx: ExternalRunnerContext;
}

// ============================================================================
// Domain Machine Config
// ============================================================================

/**
 * Configuration for creating a domain machine via createDomainMachine().
 * Domain machines provide their states, guards, action registry, and
 * a function to refresh context from external sources.
 */
export interface DomainMachineConfig<
  TDomainContext,
  TAction extends { type: string },
  _TEvent extends EventObject = EventObject,
> {
  /** Machine identifier */
  id: string;
  /**
   * Domain-specific XState state nodes.
   * These handle routing and action queue building.
   * Must include transitions to 'executingQueue' to hand off to the runner.
   */
  domainStates: Record<string, unknown>;
  /** Domain guard functions */
  guards: Record<
    string,
    (args: {
      context: RunnerMachineContext<TDomainContext, TAction>;
    }) => boolean
  >;
  /** Domain XState actions (assign, etc.) */
  actions?: Record<string, unknown>;
  /** Registry of executable action definitions (accepts both ActionRegistry and BuiltRegistry) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- action type varies per entry; runtime lookup is by action.type
  actionRegistry: Record<string, ActionDefinition<any, TDomainContext>>;
  /** Refresh domain context from external sources (e.g., re-fetch from GitHub) */
  refreshContext: (
    runnerCtx: ExternalRunnerContext,
    current: TDomainContext,
  ) => Promise<TDomainContext>;
  /** Auto-persist domain context after every queue drain (optional). */
  persistContext?: (
    runnerCtx: ExternalRunnerContext,
    domain: TDomainContext,
  ) => Promise<void>;
}

/**
 * Input provided when creating a PEV machine actor.
 */
export interface PevMachineInput<TDomainContext, TServices = unknown> {
  /** Initial domain context */
  domain: TDomainContext;
  /** Maximum transitions before exiting */
  maxCycles?: number;
  /** External runner context */
  runnerCtx: ExternalRunnerContext;
  /** Injected services (passed through to action execute) */
  services: TServices;
}
