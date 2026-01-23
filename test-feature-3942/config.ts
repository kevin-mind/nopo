/**
 * Mock configuration for test feature 3942
 * This file is used to test the automation workflow infrastructure
 */

export interface TestFeatureConfig {
  enabled: boolean;
  name: string;
  version: string;
}

export const defaultConfig: TestFeatureConfig = {
  enabled: true,
  name: 'test-feature-3942',
  version: '1.0.0',
};

export function getConfig(overrides?: Partial<TestFeatureConfig>): TestFeatureConfig {
  return {
    ...defaultConfig,
    ...overrides,
  };
}
