/**
 * Configurable Test Runner Module
 *
 * Exports types, loader, and runner for state-based fixture testing.
 */

// Types
export {
  type StateName,
  type ClaudeMock,
  type TestSubIssue,
  type TestPR,
  type StateFixture,
  type ScenarioConfig,
  type TestRunnerInputs,
  type StateTransitionResult,
  type ConfigurableTestResult,
  type LoadedScenario,
  ClaudeMockSchema,
  StateFixtureSchema,
  ScenarioConfigSchema,
  TestRunnerInputsSchema,
  ConfigurableTestResultSchema,
} from "./types.js";

// Loader
export { loadScenario, listScenarios, validateScenario } from "./loader.js";

// Runner
// Note: The full runner implementation is in .github/actions-ts/sm-test-runner/src/configurable/runner.ts
// This package exports types and loader utilities used by the action.

/**
 * Placeholder for runConfigurableTest
 * The implementation is in the sm-test-runner action, not this package,
 * because it uses @actions/core for logging which is action-specific.
 */
export async function runConfigurableTest(
  _scenario: LoadedScenario,
  _inputs: TestRunnerInputs,
  _config: {
    octokit: unknown;
    reviewOctokit?: unknown;
    owner: string;
    repo: string;
    projectNumber: number;
  },
): Promise<ConfigurableTestResult> {
  throw new Error(
    "runConfigurableTest is implemented in .github/actions-ts/sm-test-runner, not this package. " +
      "Use the sm-test-runner action directly.",
  );
}

// Re-import for placeholder function signature
import type {
  LoadedScenario,
  TestRunnerInputs,
  ConfigurableTestResult,
} from "./types.js";
