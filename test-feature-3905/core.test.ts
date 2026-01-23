import { describe, expect, it } from "vitest";

import {
  executePhase,
  getDefaultConfig,
  getNextPhase,
  isValidPhase,
  processAllPhases,
} from "./core";
import {
  DEFAULT_TIMEOUT,
  FEATURE_NAME,
  FEATURE_VERSION,
  MAX_RETRIES,
} from "./constants";

describe("test-feature-3905 core logic", () => {
  describe("getDefaultConfig", () => {
    it("returns the expected default configuration", () => {
      const config = getDefaultConfig();

      expect(config).toEqual({
        name: FEATURE_NAME,
        version: FEATURE_VERSION,
        timeout: DEFAULT_TIMEOUT,
        maxRetries: MAX_RETRIES,
      });
    });
  });

  describe("isValidPhase", () => {
    it("returns true for valid phases", () => {
      expect(isValidPhase("setup")).toBe(true);
      expect(isValidPhase("implementation")).toBe(true);
      expect(isValidPhase("finalization")).toBe(true);
    });

    it("returns false for invalid phases", () => {
      expect(isValidPhase("invalid")).toBe(false);
      expect(isValidPhase("")).toBe(false);
      expect(isValidPhase("SETUP")).toBe(false);
    });
  });

  describe("getNextPhase", () => {
    it("returns the next phase in sequence", () => {
      expect(getNextPhase("setup")).toBe("implementation");
      expect(getNextPhase("implementation")).toBe("finalization");
    });

    it("returns undefined for the last phase", () => {
      expect(getNextPhase("finalization")).toBeUndefined();
    });
  });

  describe("executePhase", () => {
    it("successfully executes a valid phase", () => {
      const result = executePhase("setup");

      expect(result.success).toBe(true);
      expect(result.phase).toBe("setup");
      expect(result.message).toBe('Phase "setup" completed successfully');
      expect(typeof result.timestamp).toBe("number");
    });

    it("returns all phase results with correct structure", () => {
      const result = executePhase("implementation");

      expect(result).toMatchObject({
        success: true,
        phase: "implementation",
        message: 'Phase "implementation" completed successfully',
      });
    });
  });

  describe("processAllPhases", () => {
    it("processes all three phases", () => {
      const results = processAllPhases();

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("processes phases in correct order", () => {
      const results = processAllPhases();

      expect(results[0].phase).toBe("setup");
      expect(results[1].phase).toBe("implementation");
      expect(results[2].phase).toBe("finalization");
    });
  });
});
