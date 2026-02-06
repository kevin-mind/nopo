/**
 * Test Runner Module
 *
 * Infrastructure for testing the state machine via GitHub automation.
 * Includes:
 * - Types for test fixtures and results
 * - Poller for exponential backoff polling
 * - Predictor for state machine simulation
 * - GitHub state fetching utilities
 * - Configurable test runner for state-based fixture testing
 */

// Core types
export {
  type PollerConfig,
  type PollResult,
  type PredictedState,
  type GuardResult,
  type WorkflowRun,
  type GitHubState,
  type Diagnosis,
  type PhaseResult,
  type TestResult,
  type MockOutputs,
  type StateSnapshot,
  type TriageExpectation,
  type PhaseExpectation,
  type CompletionExpectation,
  type TriageResult,
  type PhaseWaitResult,
  type TestFixture,
  type RunnerConfig,
} from "./types.js";

// Poller utilities
export {
  DEFAULT_POLLER_CONFIG,
  setupCancellationHandlers,
  pollUntil,
  pollUntilStateChanges,
  pollUntilState,
  pollUntilAnyState,
} from "./poller.js";

// Predictor utilities
export {
  predictNextState,
  isTerminalState,
  isFinalState,
  statusToExpectedState,
  stateToStatus,
  getExpectedStateAfterTrigger,
} from "./predictor.js";

// GitHub state utilities
export {
  deriveBranchName,
  fetchGitHubState,
  simulateMerge,
  fetchRecentWorkflowRuns,
  fetchLatestCIRun,
  hasRunningWorkflows,
  buildContextFromState,
} from "./github-state.js";

// Configurable test runner
export * from "./configurable/index.js";
