/**
 * Mock configuration for test feature 3937
 * This file is used to test the automation workflow
 */

export interface Config {
  enabled: boolean;
  name: string;
  version: string;
}

export const config: Config = {
  enabled: true,
  name: "test-feature-3937",
  version: "1.0.0",
};

export function getConfig(): Config {
  return { ...config };
}
