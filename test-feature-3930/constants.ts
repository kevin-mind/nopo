/**
 * Mock constants for testing automation workflow.
 * This file simulates infrastructure constants for issue #3930.
 */

export const MOCK_CONSTANTS = {
  MAX_RETRIES: 3,
  TIMEOUT_MS: 5000,
  DEFAULT_NAME: "test-feature-3930",
} as const;

export const FEATURE_FLAGS = {
  ENABLED: true,
  DEBUG_MODE: false,
} as const;

export type MockConstantsType = typeof MOCK_CONSTANTS;
export type FeatureFlagsType = typeof FEATURE_FLAGS;
