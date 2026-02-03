/**
 * Tests for the discussion fixture loader
 */

import { describe, test, expect } from "vitest";
import * as path from "path";
import {
  loadDiscussionScenario,
  listDiscussionScenarios,
} from "../src/configurable/discussion-loader.js";

// Test fixtures are at .github/statemachine/discussion/fixtures relative to repo root
// From issue/actions-ts/test-runner/__tests__, we need to go up to statemachine/discussion/fixtures
const TEST_FIXTURES_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "discussion",
  "fixtures",
);

describe("Discussion Loader", () => {
  describe("listDiscussionScenarios", () => {
    test("lists available discussion scenarios", async () => {
      const scenarios = await listDiscussionScenarios(TEST_FIXTURES_PATH);

      // Should have at least the scenarios we created
      expect(scenarios).toContain("research");
      expect(scenarios).toContain("respond");
      expect(scenarios).toContain("summarize");
      expect(scenarios).toContain("plan");
      expect(scenarios).toContain("complete");
    });
  });

  describe("loadDiscussionScenario", () => {
    test("loads research scenario", async () => {
      const scenario = await loadDiscussionScenario(
        "research",
        TEST_FIXTURES_PATH,
      );

      expect(scenario.name).toBe("discussion-research");
      expect(scenario.category).toBe("q-a");
      expect(scenario.orderedStates).toContain("researching");
      expect(scenario.fixtures.size).toBeGreaterThan(0);
    });

    test("loads respond scenario", async () => {
      const scenario = await loadDiscussionScenario(
        "respond",
        TEST_FIXTURES_PATH,
      );

      expect(scenario.name).toBe("discussion-respond");
      expect(scenario.category).toBe("q-a");
      expect(scenario.orderedStates).toContain("responding");

      const fixture = scenario.fixtures.get("responding");
      expect(fixture).toBeDefined();
      expect(fixture?.trigger).toBe("discussion_comment");
      expect(fixture?.discussion.commentBody).toBeDefined();
    });

    test("loads summarize scenario", async () => {
      const scenario = await loadDiscussionScenario(
        "summarize",
        TEST_FIXTURES_PATH,
      );

      expect(scenario.name).toBe("discussion-summarize");
      expect(scenario.category).toBe("ideas");
      expect(scenario.orderedStates).toContain("summarizing");

      const fixture = scenario.fixtures.get("summarizing");
      expect(fixture).toBeDefined();
      expect(fixture?.trigger).toBe("discussion_command");
      expect(fixture?.discussion.command).toBe("/summarize");
    });

    test("loads plan scenario", async () => {
      const scenario = await loadDiscussionScenario("plan", TEST_FIXTURES_PATH);

      expect(scenario.name).toBe("discussion-plan");
      expect(scenario.category).toBe("ideas");
      expect(scenario.orderedStates).toContain("planning");

      const fixture = scenario.fixtures.get("planning");
      expect(fixture).toBeDefined();
      expect(fixture?.trigger).toBe("discussion_command");
      expect(fixture?.discussion.command).toBe("/plan");
      expect(fixture?.expected?.createdIssues).toBeDefined();
    });

    test("loads complete scenario", async () => {
      const scenario = await loadDiscussionScenario(
        "complete",
        TEST_FIXTURES_PATH,
      );

      expect(scenario.name).toBe("discussion-complete");
      expect(scenario.category).toBe("q-a");
      expect(scenario.orderedStates).toContain("completing");

      const fixture = scenario.fixtures.get("completing");
      expect(fixture).toBeDefined();
      expect(fixture?.trigger).toBe("discussion_command");
      expect(fixture?.discussion.command).toBe("/complete");
    });

    test("loads referenced claude mocks", async () => {
      const scenario = await loadDiscussionScenario(
        "research",
        TEST_FIXTURES_PATH,
      );

      expect(scenario.claudeMocks.size).toBeGreaterThan(0);
      const mock = scenario.claudeMocks.get("discussion-research/basic");
      expect(mock).toBeDefined();
      expect(mock?.output).toBeDefined();
      expect(mock?.output.research_threads).toBeDefined();
    });

    test("throws error for non-existent scenario", async () => {
      await expect(
        loadDiscussionScenario("non-existent", TEST_FIXTURES_PATH),
      ).rejects.toThrow(/not found/);
    });
  });
});
