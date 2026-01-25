/**
 * Mock configuration for testing automation workflow.
 * Part of issue #3921 - Phase 1 infrastructure setup.
 */

export interface TestConfig {
  enabled: boolean;
  maxRetries: number;
  timeout: number;
}

export const defaultConfig: TestConfig = {
  enabled: true,
  maxRetries: 3,
  timeout: 5000,
};

export function getConfig(overrides?: Partial<TestConfig>): TestConfig {
  return {
    ...defaultConfig,
    ...overrides,
  };
}
