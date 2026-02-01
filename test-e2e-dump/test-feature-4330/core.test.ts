/**
 * @module test-feature-4330/core.test
 *
 * Unit tests for the E2E test feature #4330.
 */

import { describe, expect, it } from "vitest";

import { FEATURE_NAME, FEATURE_VERSION, STAGES, Stage } from "./constants";
import {
  executeStage,
  getDefaultConfig,
  getNextStage,
  isValidStage,
  processAllStages,
} from "./core";

describe("getDefaultConfig", () => {
  it("returns a config with the correct feature name", () => {
    const config = getDefaultConfig();
    expect(config.name).toBe(FEATURE_NAME);
  });

  it("returns a config with the correct version", () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(FEATURE_VERSION);
  });

  it("returns a config with positive timeout", () => {
    const config = getDefaultConfig();
    expect(config.timeout).toBeGreaterThan(0);
  });

  it("returns a config with positive maxRetries", () => {
    const config = getDefaultConfig();
    expect(config.maxRetries).toBeGreaterThan(0);
  });
});

describe("isValidStage", () => {
  it.each(STAGES)('returns true for valid stage "%s"', (stage) => {
    expect(isValidStage(stage)).toBe(true);
  });

  it("returns false for an invalid stage", () => {
    expect(isValidStage("invalid")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidStage("")).toBe(false);
  });
});

describe("getNextStage", () => {
  it('returns "validate" after "init"', () => {
    expect(getNextStage("init")).toBe("validate");
  });

  it('returns "complete" after "validate"', () => {
    expect(getNextStage("validate")).toBe("complete");
  });

  it('returns undefined after "complete"', () => {
    expect(getNextStage("complete")).toBeUndefined();
  });
});

describe("executeStage", () => {
  it.each(STAGES)('executes stage "%s" successfully', (stage) => {
    const result = executeStage(stage);
    expect(result.success).toBe(true);
    expect(result.stage).toBe(stage);
    expect(result.message).toContain(stage);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("returns failure for invalid stage", () => {
    const result = executeStage("invalid" as Stage);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid stage");
  });
});

describe("processAllStages", () => {
  it("processes all stages in order", () => {
    const results = processAllStages();
    expect(results).toHaveLength(STAGES.length);

    results.forEach((result, index) => {
      expect(result.stage).toBe(STAGES[index]);
      expect(result.success).toBe(true);
    });
  });

  it("returns results with increasing timestamps", () => {
    const results = processAllStages();

    for (let i = 1; i < results.length; i++) {
      expect(results[i].timestamp).toBeGreaterThanOrEqual(
        results[i - 1].timestamp,
      );
    }
  });
});
