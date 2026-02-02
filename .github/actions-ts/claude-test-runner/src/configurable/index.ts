/**
 * Configurable Test Runner Module
 *
 * Provides state-based fixture testing for the Claude automation state machine.
 */

// Issue Types
export { type TestRunnerInputs } from "./types.js";

// Issue Loader
export { loadScenario } from "./loader.js";

// Issue Runner
export { runConfigurableTest } from "./runner.js";

// Discussion Types
export { type DiscussionTestRunnerInputs } from "./discussion-types.js";

// Discussion Loader
export { loadDiscussionScenario } from "./discussion-loader.js";

// Discussion Runner
export { runDiscussionConfigurableTest } from "./discussion-runner.js";
