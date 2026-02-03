import { describe, test, expect } from "vitest";
import { join } from "path";
import { loadScenario } from "../src/configurable/loader.js";

// Test fixtures are at .github/statemachine/issue/fixtures relative to repo root
// From issue/actions-ts/test-runner/__tests__, we need to go up to statemachine/issue/fixtures
// __dirname = .github/statemachine/issue/actions-ts/test-runner/__tests__
// Go up: test-runner -> actions-ts -> issue -> then fixtures
const TEST_FIXTURES_PATH = join(
  __dirname,
  "..",  // test-runner
  "..",  // actions-ts
  "..",  // issue
  "fixtures",
);

describe("Issue Loader", () => {
  describe("loadScenario", () => {
    test("loads issue-comment scenario", async () => {
      console.log("Loading issue scenario: issue-comment");
      const scenario = await loadScenario("issue-comment", TEST_FIXTURES_PATH);

      expect(scenario.name).toBe("issue-comment");
      expect(scenario.description).toContain("@claude mention");
      expect(scenario.orderedStates.length).toBeGreaterThanOrEqual(2);
      expect(scenario.fixtures.size).toBeGreaterThan(0);

      // Check first state is commenting
      const firstState = scenario.orderedStates[0];
      expect(firstState).toBe("commenting");

      const fixture = scenario.fixtures.get("commenting");
      expect(fixture).toBeDefined();
      expect(fixture?.trigger).toBe("issue-comment");
    });

    test("loads issue-reset scenario", async () => {
      console.log("Loading issue scenario: issue-reset");
      const scenario = await loadScenario("issue-reset", TEST_FIXTURES_PATH);

      expect(scenario.name).toBe("issue-reset");
      expect(scenario.description).toContain("/reset");
      expect(scenario.orderedStates.length).toBeGreaterThanOrEqual(2);
      expect(scenario.fixtures.size).toBeGreaterThan(0);

      // Check first state is resetting
      const firstState = scenario.orderedStates[0];
      expect(firstState).toBe("resetting");

      const fixture = scenario.fixtures.get("resetting");
      expect(fixture).toBeDefined();
      expect(fixture?.trigger).toBe("issue-reset");
    });

    test("loads slash-lfg scenario", async () => {
      console.log("Loading issue scenario: slash-lfg");
      const scenario = await loadScenario("slash-lfg", TEST_FIXTURES_PATH);

      expect(scenario.name).toBe("slash-lfg");
      expect(scenario.description).toContain("/lfg");
      expect(scenario.orderedStates.length).toBeGreaterThanOrEqual(2);
      expect(scenario.fixtures.size).toBeGreaterThan(0);

      // Check first state is iterating
      const firstState = scenario.orderedStates[0];
      expect(firstState).toBe("iterating");

      const fixture = scenario.fixtures.get("iterating");
      expect(fixture).toBeDefined();
    });

    test("throws error for non-existent scenario", async () => {
      await expect(
        loadScenario("non-existent-scenario", TEST_FIXTURES_PATH),
      ).rejects.toThrow(/not found/);
    });
  });
});
