// @more/statemachine - PEV state machine for GitHub automation
// Core: action-utils (used by sm-pev), PEV infrastructure, example machine

// Core utilities
export * from "./core/action-utils.js";

// Claude SDK utilities (re-exported from @more/claude for backward compatibility)
export * from "@more/claude";

// PEV (Predict-Execute-Verify) machine infrastructure
export {
  createDomainMachine,
  createMachineFactory,
  RUNNER_STATES,
  type RunnerState,
  type ActionDefinition,
  type ActionRegistry,
  type DomainMachineConfig,
  type ExternalRunnerContext,
  type PevMachineInput,
  type PredictResult,
  type RunnerMachineContext,
  type PevVerifyResult,
  type TActionInput,
  type TAction,
  type TActionDefs,
  type RegistryEntry,
  type ActionFromRegistry,
} from "./core/pev/index.js";

// Example PEV machine
export * from "./machines/example/index.js";
