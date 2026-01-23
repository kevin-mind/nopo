/**
 * Mock configuration file for testing automation workflow.
 * This file is part of issue #3947 - Phase 1 infrastructure setup.
 */

export interface MockConfig {
  enabled: boolean;
  name: string;
  version: string;
}

export const mockConfig: MockConfig = {
  enabled: true,
  name: "test-feature-3947",
  version: "1.0.0",
};

export default mockConfig;
