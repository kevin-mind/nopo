/**
 * Mock constants for testing automation workflow.
 * Part of issue #3921 - Phase 1 infrastructure setup.
 */

export const TEST_FEATURE_NAME = "test-feature-3921";

export const DEFAULT_VALUES = {
  MIN_VALUE: 0,
  MAX_VALUE: 100,
  STEP: 1,
} as const;

export const STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
} as const;

export type StatusType = (typeof STATUS)[keyof typeof STATUS];
