/**
 * Mock constants file for testing automation workflow.
 * Part of issue #4094 - Phase 1: Setup infrastructure
 */

export const API_VERSION = 'v1';

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_RETRIES = 3;

export const FEATURE_FLAGS = {
  ENABLE_MOCK_DATA: true,
  DEBUG_MODE: false,
} as const;
