/**
 * @module test-feature-3905/constants
 *
 * Constants for E2E test feature #3905.
 * These values configure the test feature behavior and define the phase workflow.
 */

/** Unique identifier for this test feature */
export const FEATURE_NAME = "test-feature-3905";

/** Current version of the test feature */
export const FEATURE_VERSION = "1.0.0";

/** Default timeout for operations in milliseconds */
export const DEFAULT_TIMEOUT = 30000;

/** Maximum number of retry attempts on failure */
export const MAX_RETRIES = 3;

/** Ordered list of phases in the workflow */
export const PHASES = ["setup", "implementation", "finalization"] as const;

/** Union type of valid phase names */
export type Phase = (typeof PHASES)[number];
