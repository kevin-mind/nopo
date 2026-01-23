/**
 * Mock configuration for testing automation workflow.
 * This file simulates setting up infrastructure for issue #3930.
 */

export interface MockConfig {
  enabled: boolean;
  name: string;
  version: string;
}

export const mockConfig: MockConfig = {
  enabled: true,
  name: "test-feature-3930",
  version: "1.0.0",
};

export function getConfig(): MockConfig {
  return mockConfig;
}
