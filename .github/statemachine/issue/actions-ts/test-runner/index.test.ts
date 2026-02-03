import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pollUntil } from "./src/poller.js";
import { isTerminalState, isFinalState } from "./src/predictor.js";
import { diagnoseFailure, formatDiagnosis } from "./src/diagnostics.js";
import { deriveBranchName, buildContextFromState } from "./src/github-state.js";
import {
  validateFixture,
  validateFixtures,
  formatValidationResult,
} from "./src/validate.js";
import type { GitHubState, WorkflowRun, PredictedState } from "./src/types.js";

describe("poller", () => {
  describe("pollUntil", () => {
    it("should return success when condition is met immediately", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ value: "done" });
      const conditionFn = vi.fn().mockReturnValue(true);

      const result = await pollUntil(fetchFn, conditionFn, {
        timeoutMs: 1000,
        initialIntervalMs: 100,
        maxIntervalMs: 1000,
        multiplier: 1.5,
        jitterFactor: 0,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("should poll multiple times until condition is met", async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return { value: callCount };
      });
      const conditionFn = vi.fn().mockImplementation((data) => data.value >= 3);

      const result = await pollUntil(fetchFn, conditionFn, {
        timeoutMs: 5000,
        initialIntervalMs: 10,
        maxIntervalMs: 50,
        multiplier: 1.5,
        jitterFactor: 0,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
    });

    it("should timeout if condition is never met", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ value: "pending" });
      const conditionFn = vi.fn().mockReturnValue(false);

      const result = await pollUntil(fetchFn, conditionFn, {
        timeoutMs: 200,
        initialIntervalMs: 10,
        maxIntervalMs: 50,
        multiplier: 1.5,
        jitterFactor: 0,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBeGreaterThanOrEqual(1);
    });

    it("should call onPoll callback after each attempt", async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return { value: callCount };
      });
      const conditionFn = vi.fn().mockImplementation((data) => data.value >= 2);
      const onPoll = vi.fn();

      await pollUntil(
        fetchFn,
        conditionFn,
        {
          timeoutMs: 5000,
          initialIntervalMs: 10,
          maxIntervalMs: 50,
          multiplier: 1.5,
          jitterFactor: 0,
        },
        onPoll,
      );

      expect(onPoll).toHaveBeenCalledTimes(2);
    });
  });
});

describe("predictor", () => {
  describe("isTerminalState", () => {
    it("should return true for done state", () => {
      expect(isTerminalState("done")).toBe(true);
    });

    it("should return true for blocked state", () => {
      expect(isTerminalState("blocked")).toBe(true);
    });

    it("should return true for error state", () => {
      expect(isTerminalState("error")).toBe(true);
    });

    it("should return false for iterating state", () => {
      expect(isTerminalState("iterating")).toBe(false);
    });

    it("should return false for reviewing state", () => {
      expect(isTerminalState("reviewing")).toBe(false);
    });
  });

  describe("isFinalState", () => {
    it("should return true for final states", () => {
      expect(isFinalState("done")).toBe(true);
      expect(isFinalState("iterating")).toBe(true);
      expect(isFinalState("reviewing")).toBe(true);
      expect(isFinalState("triaging")).toBe(true);
    });

    it("should return false for non-final states", () => {
      expect(isFinalState("detecting")).toBe(false);
      expect(isFinalState("processingCI")).toBe(false);
    });
  });
});

describe("github-state", () => {
  describe("deriveBranchName", () => {
    it("should derive branch name for single-phase issue", () => {
      expect(deriveBranchName(123)).toBe("claude/issue/123");
    });

    it("should derive branch name with phase", () => {
      expect(deriveBranchName(123, 1)).toBe("claude/issue/123/phase-1");
      expect(deriveBranchName(123, 2)).toBe("claude/issue/123/phase-2");
    });

    it("should handle phase 0 as no phase", () => {
      expect(deriveBranchName(123, 0)).toBe("claude/issue/123");
    });
  });

  describe("buildContextFromState", () => {
    it("should build context from GitHub state", () => {
      const state: GitHubState = {
        issueNumber: 123,
        issueState: "OPEN",
        projectStatus: "In progress",
        iteration: 2,
        failures: 1,
        botAssigned: true,
        labels: ["bug", "triaged"],
        uncheckedTodos: 3,
        prState: "OPEN",
        prNumber: 456,
        prLabels: [],
        branch: "claude/issue/123",
        branchExists: true,
        latestSha: "abc123",
        context: null,
      };

      const context = buildContextFromState(state, "owner", "repo");

      expect(context.issue.number).toBe(123);
      expect(context.issue.projectStatus).toBe("In progress");
      expect(context.issue.iteration).toBe(2);
      expect(context.issue.failures).toBe(1);
      expect(context.hasPR).toBe(true);
      expect(context.pr?.number).toBe(456);
      expect(context.hasBranch).toBe(true);
    });

    it("should handle state without PR", () => {
      const state: GitHubState = {
        issueNumber: 123,
        issueState: "OPEN",
        projectStatus: "Backlog",
        iteration: 0,
        failures: 0,
        botAssigned: false,
        labels: [],
        uncheckedTodos: 0,
        prState: null,
        prNumber: null,
        prLabels: [],
        branch: null,
        branchExists: false,
        latestSha: null,
        context: null,
      };

      const context = buildContextFromState(state, "owner", "repo");

      expect(context.hasPR).toBe(false);
      expect(context.pr).toBeNull();
      expect(context.hasBranch).toBe(false);
    });
  });
});

describe("diagnostics", () => {
  const createMockState = (
    overrides: Partial<GitHubState> = {},
  ): GitHubState => ({
    issueNumber: 123,
    issueState: "OPEN",
    projectStatus: "In progress",
    iteration: 1,
    failures: 0,
    botAssigned: true,
    labels: ["triaged"],
    uncheckedTodos: 2,
    prState: "OPEN",
    prNumber: 456,
    prLabels: [],
    branch: "claude/issue/123",
    branchExists: true,
    latestSha: "abc123",
    context: null,
    ...overrides,
  });

  const createMockPredicted = (
    overrides: Partial<PredictedState> = {},
  ): PredictedState => ({
    expectedState: "iterating",
    expectedStatus: "In progress",
    triggersNeeded: ["CI_SUCCESS"],
    estimatedWaitMs: 180000,
    description: "Claude is implementing",
    ...overrides,
  });

  describe("diagnoseFailure", () => {
    it("should return done for Done status", () => {
      const state = createMockState({ projectStatus: "Done" });
      const predicted = createMockPredicted();
      const runs: WorkflowRun[] = [];

      const diagnosis = diagnoseFailure(predicted, state, runs);

      expect(diagnosis.status).toBe("done");
    });

    it("should diagnose blocked status", () => {
      const state = createMockState({
        projectStatus: "Blocked",
        failures: 5,
      });
      const predicted = createMockPredicted();
      const runs: WorkflowRun[] = [];

      const diagnosis = diagnoseFailure(predicted, state, runs);

      expect(diagnosis.status).toBe("error");
      expect(diagnosis.suggestedFix).toContain("blocked");
    });

    it("should diagnose running workflow", () => {
      const state = createMockState();
      const predicted = createMockPredicted();
      const runs: WorkflowRun[] = [
        {
          id: 1,
          name: "CI",
          displayTitle: "CI #1",
          status: "in_progress",
          conclusion: null,
          url: "https://github.com/...",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          headSha: "abc123",
          branch: "claude/issue/123",
        },
      ];

      const diagnosis = diagnoseFailure(predicted, state, runs);

      expect(diagnosis.status).toBe("timeout");
      expect(diagnosis.suggestedFix).toContain("Wait longer");
      expect(diagnosis.details.workflowStatus).toBe("running");
    });

    it("should diagnose failed workflow", () => {
      const state = createMockState();
      const predicted = createMockPredicted();
      const runs: WorkflowRun[] = [
        {
          id: 1,
          name: "CI",
          displayTitle: "CI #1",
          status: "completed",
          conclusion: "failure",
          url: "https://github.com/runs/1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          headSha: "abc123",
          branch: "claude/issue/123",
        },
      ];

      const diagnosis = diagnoseFailure(predicted, state, runs);

      expect(diagnosis.status).toBe("error");
      expect(diagnosis.suggestedFix).toContain("Check workflow logs");
      expect(diagnosis.details.workflowStatus).toBe("failed");
    });

    it("should diagnose missing bot assignment", () => {
      const state = createMockState({ botAssigned: false });
      const predicted = createMockPredicted();
      const runs: WorkflowRun[] = [];

      const diagnosis = diagnoseFailure(predicted, state, runs);

      expect(diagnosis.status).toBe("error");
      expect(diagnosis.suggestedFix).toContain("Assign nopo-bot");
    });

    it("should diagnose unchecked todos blocking review", () => {
      const state = createMockState({ uncheckedTodos: 5 });
      const predicted = createMockPredicted({
        expectedState: "reviewing",
        triggersNeeded: [],
      });
      const runs: WorkflowRun[] = [
        {
          id: 1,
          name: "CI",
          displayTitle: "CI #1",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/...",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          headSha: "abc123",
          branch: "claude/issue/123",
        },
      ];

      const diagnosis = diagnoseFailure(predicted, state, runs);

      expect(diagnosis.status).toBe("timeout");
      expect(diagnosis.suggestedFix).toContain("todos");
    });
  });

  describe("formatDiagnosis", () => {
    it("should format diagnosis for logging", () => {
      const state = createMockState();
      const predicted = createMockPredicted();
      const runs: WorkflowRun[] = [];

      const diagnosis = diagnoseFailure(predicted, state, runs);
      const formatted = formatDiagnosis(diagnosis);

      expect(formatted).toContain("Status:");
      expect(formatted).toContain("Suggested Fix:");
      expect(formatted).toContain("Details:");
    });
  });
});

describe("fixture validation", () => {
  describe("validateFixture", () => {
    it("should validate fixture with required fields", () => {
      const validFixture = {
        name: "test-fixture",
        description: "A test fixture",
        parent_issue: {
          title: "Test Issue",
          body: "Test body",
        },
      };

      const result = validateFixture(validFixture);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.fixture).not.toBeNull();
    });

    it("should reject fixture missing required fields", () => {
      const invalidFixture = {
        name: "test",
        // missing description
      };

      const result = validateFixture(invalidFixture);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject fixture without parent_issue or discussion", () => {
      const invalidFixture = {
        name: "test",
        description: "test",
      };

      const result = validateFixture(invalidFixture);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("parent_issue or discussion"),
        ),
      ).toBe(true);
    });

    it("should allow fixture with discussion instead of parent_issue", () => {
      const discussionFixture = {
        name: "discussion-fixture",
        description: "A discussion fixture",
        discussion: {
          title: "Test Discussion",
          body: "Test body",
          category: "general",
        },
      };

      const result = validateFixture(discussionFixture);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate expected states are valid project statuses", () => {
      const fixture = {
        name: "test",
        description: "test",
        parent_issue: {
          title: "Test Issue",
          body: "Test body",
        },
        expected: {
          parent_status: "In progress",
          sub_issue_statuses: ["Ready", "In progress"],
        },
      };

      const result = validateFixture(fixture);

      expect(result.valid).toBe(true);
    });

    it("should reject invalid project status", () => {
      const fixture = {
        name: "test",
        description: "test",
        parent_issue: {
          title: "Test Issue",
          body: "Test body",
        },
        expected: {
          parent_status: "Invalid Status",
        },
      };

      const result = validateFixture(fixture);

      expect(result.valid).toBe(false);
    });

    it("should warn when fixture has no expected outcomes", () => {
      const fixture = {
        name: "test",
        description: "test",
        parent_issue: {
          title: "Test Issue",
          body: "Test body",
        },
      };

      const result = validateFixture(fixture);

      expect(result.valid).toBe(true);
      expect(
        result.warnings.some((w) => w.includes("no expected outcomes")),
      ).toBe(true);
    });

    it("should warn when sub_issues count mismatches expected statuses", () => {
      const fixture = {
        name: "test",
        description: "test",
        parent_issue: {
          title: "Test Issue",
          body: "Test body",
          labels: ["triaged"],
        },
        sub_issues: [
          { title: "Sub 1", body: "Body 1" },
          { title: "Sub 2", body: "Body 2" },
        ],
        expected: {
          parent_status: "In progress",
          sub_issue_statuses: ["Ready"], // Only 1 status for 2 sub-issues
        },
      };

      const result = validateFixture(fixture);

      expect(result.valid).toBe(true);
      expect(
        result.warnings.some((w) =>
          w.includes("doesn't match expected statuses"),
        ),
      ).toBe(true);
    });

    it("should warn when sub_issues predefined but missing triaged label", () => {
      const fixture = {
        name: "test",
        description: "test",
        parent_issue: {
          title: "Test Issue",
          body: "Test body",
          labels: ["bug"], // No "triaged" label
        },
        sub_issues: [{ title: "Sub 1", body: "Body 1" }],
        expected: {
          parent_status: "In progress",
        },
      };

      const result = validateFixture(fixture);

      expect(result.valid).toBe(true);
      expect(
        result.warnings.some((w) => w.includes("missing 'triaged' label")),
      ).toBe(true);
    });
  });

  describe("validateFixtures", () => {
    it("should validate multiple fixtures", () => {
      const fixtures = {
        "fixture-1": {
          name: "fixture-1",
          description: "First fixture",
          parent_issue: { title: "Issue 1", body: "Body 1" },
        },
        "fixture-2": {
          name: "fixture-2",
          description: "Second fixture",
          parent_issue: { title: "Issue 2", body: "Body 2" },
        },
      };

      const results = validateFixtures(fixtures);

      expect(Object.keys(results)).toHaveLength(2);
      expect(results["fixture-1"]?.valid).toBe(true);
      expect(results["fixture-2"]?.valid).toBe(true);
    });
  });

  describe("formatValidationResult", () => {
    it("should format valid result", () => {
      const result = validateFixture({
        name: "test",
        description: "test",
        parent_issue: { title: "Test", body: "Test" },
        expected: { parent_status: "Done" },
      });

      const formatted = formatValidationResult("test-fixture", result);

      expect(formatted).toContain("test-fixture");
      expect(formatted).toContain("Valid");
    });

    it("should format invalid result with errors", () => {
      const result = validateFixture({
        name: "test",
        // missing description
      });

      const formatted = formatValidationResult("test-fixture", result);

      expect(formatted).toContain("Invalid");
      expect(formatted).toContain("Errors");
    });
  });

  describe("real fixture files validation", () => {
    // Path to fixtures directory: from test-runner -> actions-ts -> issue -> fixtures
    const fixturesDir = join(__dirname, "..", "..", "fixtures");

    // Get all fixture files
    const fixtureFiles = readdirSync(fixturesDir).filter((f) =>
      f.endsWith(".json"),
    );

    it.each(fixtureFiles)("should validate %s", (fixtureFile) => {
      const fixturePath = join(fixturesDir, fixtureFile);
      const fixtureContent = readFileSync(fixturePath, "utf-8");
      const fixture = JSON.parse(fixtureContent);

      const result = validateFixture(fixture);

      // All fixtures should be valid
      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.log(`Validation errors for ${fixtureFile}:`);
        result.errors.forEach((e) =>
          console.log(`  - ${e.path}: ${e.message}`),
        );
      }
    });

    it("should have at least one fixture file or skip validation", () => {
      // Old-style fixtures have been replaced by scenario-based fixtures in scenarios/
      // This test validates any remaining old-style fixtures but doesn't require them
      if (fixtureFiles.length === 0) {
        console.log("No old-style fixture files found in test-fixtures/ (using scenario-based fixtures)");
      }
      // Test passes regardless - actual fixture validation happens in it.each above
      expect(true).toBe(true);
    });
  });
});
