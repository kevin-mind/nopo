// @more/statemachine - State machine for GitHub issue automation
// Two-directory structure: core/ (library logic) + machines/issues/ (issue state machine)

// Core: constants, schemas, parser, executor, signaler, helpers, action-utils, machine
export * from "./core/constants.js";
export * from "./core/schemas/index.js";
export * from "./core/parser/index.js";
export * from "./core/executor.js";
export { signalStart, signalEnd } from "./core/signaler.js";
export * from "./core/helpers/git.js";
export * from "./core/helpers/output-schemas.js";
export * from "./core/action-utils.js";
export * from "./core/machine.js";
export * from "./core/verifier/index.js";

// Claude SDK utilities (re-exported from @more/claude for backward compatibility)
export * from "@more/claude";

// Issue state machine (all exports including Verify namespace)
export * from "./machines/issues/index.js";
