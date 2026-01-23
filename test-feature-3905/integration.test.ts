/**
 * Integration tests for test-feature-3905.
 *
 * These tests verify that the feature components work together correctly,
 * simulating a complete workflow execution.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  executePhase,
  getDefaultConfig,
  getNextPhase,
  isValidPhase,
  processAllPhases,
  type FeatureConfig,
  type FeatureResult,
} from "./core";
import { FEATURE_NAME, PHASES, type Phase } from "./constants";

describe("test-feature-3905 integration", () => {
  describe("config.json validation", () => {
    it("config.json matches runtime constants", () => {
      const configPath = path.join(__dirname, "config.json");
      const configFile = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const runtimeConfig = getDefaultConfig();

      expect(configFile.name).toBe(runtimeConfig.name);
      expect(configFile.settings.maxRetries).toBe(runtimeConfig.maxRetries);
      expect(configFile.settings.timeout).toBe(runtimeConfig.timeout);
    });
  });

  describe("full workflow execution", () => {
    it("executes all phases from start to finish", () => {
      const config = getDefaultConfig();
      expect(config.name).toBe(FEATURE_NAME);

      const results = processAllPhases();
      expect(results).toHaveLength(PHASES.length);

      // Verify each phase completed successfully
      results.forEach((result: FeatureResult, index: number) => {
        expect(result.success).toBe(true);
        expect(result.phase).toBe(PHASES[index]);
        expect(result.timestamp).toBeGreaterThan(0);
      });
    });

    it("phase progression follows expected sequence", () => {
      let currentPhase: Phase | undefined = PHASES[0];
      const visitedPhases: Phase[] = [];

      while (currentPhase !== undefined) {
        expect(isValidPhase(currentPhase)).toBe(true);

        const result = executePhase(currentPhase);
        expect(result.success).toBe(true);

        visitedPhases.push(currentPhase);
        currentPhase = getNextPhase(currentPhase);
      }

      expect(visitedPhases).toEqual(PHASES);
    });

    it("config and execution are consistent", () => {
      const config: FeatureConfig = getDefaultConfig();
      const results = processAllPhases();

      // All results should reference the same feature
      const allSuccessful = results.every((r) => r.success);
      expect(allSuccessful).toBe(true);

      // Config should have sensible defaults
      expect(config.timeout).toBeGreaterThan(0);
      expect(config.maxRetries).toBeGreaterThan(0);
      expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
