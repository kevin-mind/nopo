/**
 * Placeholder constants for E2E test feature #3905
 * These constants are used to validate the Claude automation state machine.
 */

export const FEATURE_NAME = "test-feature-3905";
export const FEATURE_VERSION = "1.0.0";
export const DEFAULT_TIMEOUT = 30000;
export const MAX_RETRIES = 3;
export const PHASES = ["setup", "implementation", "finalization"] as const;

export type Phase = (typeof PHASES)[number];
