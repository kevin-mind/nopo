/**
 * Mock constants file for testing automation workflow.
 * This file is part of issue #3947 - Phase 1 infrastructure setup.
 */

export const FEATURE_NAME = "test-feature-3947";
export const FEATURE_VERSION = "1.0.0";
export const MAX_RETRIES = 3;
export const TIMEOUT_MS = 5000;

export const MOCK_CONSTANTS = {
  FEATURE_NAME,
  FEATURE_VERSION,
  MAX_RETRIES,
  TIMEOUT_MS,
} as const;

export default MOCK_CONSTANTS;
