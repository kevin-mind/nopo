// @more/statemachine - State machine for GitHub issue automation
// This package contains the core state machine logic, schemas, and runners

export * from "./constants.js";
export * from "./schemas/index.js";
export * from "./parser/index.js";
export * from "./machine/index.js";

// Claude SDK utilities (re-exported from @more/claude for backward compatibility)
export * from "@more/claude";

// Runner infrastructure and executors
export * from "./runner/index.js";

// Verification infrastructure
export * as Verify from "./verify/index.js";

// Test runner infrastructure
export * as TestRunner from "./test-runner/index.js";

// Discussion state machine (namespaced export)
export * as Discussion from "./discussion/index.js";

// Discussion state machine (direct exports for common items)
export {
  discussionMachine,
  buildDiscussionContext,
  type DiscussionMachineContext,
  type BuildDiscussionContextOptions,
} from "./discussion/index.js";

// Action utilities for GitHub Actions entry points
export * from "./action-utils.js";
