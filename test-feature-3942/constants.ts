/**
 * Mock constants for test feature 3942
 * This file is used to test the automation workflow infrastructure
 */

export const FEATURE_NAME = "test-feature-3942" as const;

export const FEATURE_VERSION = "1.0.0" as const;

export const DEFAULT_TIMEOUT_MS = 5000;

export const MAX_RETRIES = 3;

export const STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  ERROR: "error",
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];
