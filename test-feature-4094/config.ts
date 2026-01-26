/**
 * Mock configuration file for testing automation workflow.
 * Part of issue #4094 - Phase 1: Setup infrastructure
 */

export interface MockConfig {
  enabled: boolean;
  environment: 'development' | 'staging' | 'production';
  apiEndpoint: string;
  timeout: number;
}

export const defaultConfig: MockConfig = {
  enabled: true,
  environment: 'development',
  apiEndpoint: '/api/v1',
  timeout: 5000,
};

export function createConfig(overrides: Partial<MockConfig> = {}): MockConfig {
  return {
    ...defaultConfig,
    ...overrides,
  };
}
