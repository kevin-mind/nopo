/**
 * Runner Module
 *
 * Exports the action runner infrastructure including:
 * - Runner functions (executeActions, runWithSignaling)
 * - Context creation utilities
 * - Types for runner configuration
 * - All executors for individual action types
 * - Signaling utilities for status comments
 */

// Main runner exports
export {
  // Runner functions
  executeActions,
  runWithSignaling,
  createRunnerContext,
  createSignaledRunnerContext,
  logRunnerSummary,
  filterActions,
  countActionsByType,
  // Types
  type RunnerContext,
  type RunnerResult,
  type RunnerOptions,
  type ActionResult,
  type ActionChainContext,
  type SignaledRunnerContext,
  type SignaledRunnerResult,
  type Octokit,
  type ProgressInfo,
  type RunnerJobResult,
  type ResourceType,
  type MockOutputs,
} from "./runner.js";

// Signaler exports
export { signalStart, signalEnd } from "./signaler.js";

// Derive functions (machine derivation without output-setting)
export {
  deriveIssueActions,
  deriveDiscussionActions,
  getTransitionName,
  type DeriveResult,
  type DeriveIssueOptions,
  type DeriveDiscussionOptions,
} from "./derive.js";

// Git utility exports (executor logic moved to schemas/actions/)
export {
  checkoutBranch,
  createOrCheckoutBranch,
  getCurrentBranch,
  getCurrentSha,
  hasUncommittedChanges,
  stageAllChanges,
  commit,
  fetch,
  rebase,
} from "./helpers/git.js";

// Output schema exports (used by tests + parser)
export * from "./helpers/output-schemas.js";
