/**
 * Configurable Test Runner Module
 *
 * Provides state-based fixture testing for the Claude automation state machine.
 */

// Types
export {
  StateNameSchema,
  ClaudeMockSchema,
  StateFixtureSchema,
  ScenarioConfigSchema,
  TestRunnerInputsSchema,
  StateTransitionResultSchema,
  TestResultSchema,
  type StateName,
  type ClaudeMock,
  type StateFixture,
  type ScenarioConfig,
  type TestRunnerInputs,
  type StateTransitionResult,
  type TestResult,
  type LoadedScenario,
} from "./types.js";

// Loader
export {
  loadScenario,
  listScenarios,
  validateScenario,
} from "./loader.js";

// Runner
export {
  ConfigurableTestRunner,
  runConfigurableTest,
} from "./runner.js";
