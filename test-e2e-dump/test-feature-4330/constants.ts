/**
 * @module test-feature-4330/constants
 *
 * Constants for E2E test feature #4330.
 * These values configure the test feature behavior and define the validation workflow.
 */

/** Unique identifier for this test feature */
export const FEATURE_NAME = "test-feature-4330";

/** Current version of the test feature */
export const FEATURE_VERSION = "1.0.0";

/** Default timeout for operations in milliseconds */
export const DEFAULT_TIMEOUT = 30000;

/** Maximum number of retry attempts on failure */
export const MAX_RETRIES = 3;

/** Ordered list of validation stages */
export const STAGES = ["init", "validate", "complete"] as const;

/** Union type of valid stage names */
export type Stage = (typeof STAGES)[number];
