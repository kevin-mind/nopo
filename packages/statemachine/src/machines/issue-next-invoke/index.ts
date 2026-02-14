// Issue automation state machine — invoke-based approach

export { issueInvokeMachine } from "./machine.js";
export type { InvokeMachineContext } from "./machine.js";
export { IssueMachine } from "./issue-machine.js";
export type {
  MachineResult,
  RunOptions,
  ExecuteOptions,
  ExecuteResult,
} from "./issue-machine.js";
export { buildActionsForService, createDefaultServices } from "./services.js";
export type { ServiceInput, ServiceOutput } from "./services.js";
export {
  ContextLoader,
  buildDeriveMetadata,
  buildEventFromWorkflow,
  deriveFromWorkflow,
} from "./context-loader.js";
export type {
  ContextLoaderOptions,
  DeriveMetadata,
  WorkflowEventFields,
} from "./context-loader.js";
export { MachineVerifier } from "./verifier.js";
export type { VerificationResult } from "./verifier.js";

// Re-export shared pieces from issues/
export { STATES } from "../issues/states.js";
export type { IssueState } from "../issues/states.js";
export { guards } from "../issues/guards.js";
export { getTriggerEvent, type IssueMachineEvent } from "../issues/events.js";
