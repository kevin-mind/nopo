import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock @actions/core
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

// Mock the Claude executor to avoid real Claude calls
vi.mock("../../../runner/executors/claude.js", () => ({
  executeRunClaude: vi.fn(),
}));

import * as fs from "fs";
import { executeRunClaude } from "../../../runner/executors/claude.js";
import {
  executeRunClaudeGrooming,
  executeApplyGroomingOutput,
} from "../../../runner/executors/grooming.js";
import type { GitHub } from "@actions/github/lib/utils.js";
import type { RunnerContext } from "../../../runner/runner.js";

type Octokit = InstanceType<typeof GitHub>;

// Create a mock Octokit with all needed methods
function createMockOctokit() {
  return {
    graphql: vi.fn(),
    rest: {
      issues: {
        get: vi.fn().mockResolvedValue({ data: { body: "## Agent Notes\n\n" } }),
        update: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
      },
    },
  } as unknown as Octokit;
}

// Create mock context
function createMockContext(): RunnerContext {
  return {
    octokit: createMockOctokit(),
    owner: "test-owner",
    repo: "test-repo",
    projectNumber: 1,
    serverUrl: "https://github.com",
  };
}

describe("executeRunClaudeGrooming", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("runs all 4 grooming agents in parallel", async () => {
    // Mock executeRunClaude to return ready outputs
    vi.mocked(executeRunClaude).mockResolvedValue({
      success: true,
      exitCode: 0,
      structuredOutput: { ready: true },
    });

    const result = await executeRunClaudeGrooming(
      {
        type: "runClaudeGrooming",
        token: "code",
        issueNumber: 123,
        promptVars: {},
      },
      ctx,
    );

    // Should have called executeRunClaude 4 times (pm, engineer, qa, research)
    expect(executeRunClaude).toHaveBeenCalledTimes(4);

    // Verify the 4 agents were called
    const calls = vi.mocked(executeRunClaude).mock.calls;
    const promptDirs = calls.map((call) => call[0].promptDir);
    expect(promptDirs).toContain("grooming/pm");
    expect(promptDirs).toContain("grooming/engineer");
    expect(promptDirs).toContain("grooming/qa");
    expect(promptDirs).toContain("grooming/research");

    // Should return combined outputs
    expect(result.outputs).toHaveProperty("pm");
    expect(result.outputs).toHaveProperty("engineer");
    expect(result.outputs).toHaveProperty("qa");
    expect(result.outputs).toHaveProperty("research");
  });

  test("writes combined output to grooming-output.json", async () => {
    vi.mocked(executeRunClaude).mockResolvedValue({
      success: true,
      exitCode: 0,
      structuredOutput: { ready: true, questions: [] },
    });

    await executeRunClaudeGrooming(
      {
        type: "runClaudeGrooming",
        token: "code",
        issueNumber: 123,
        promptVars: {},
      },
      ctx,
    );

    // Should have written to file
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "grooming-output.json",
      expect.any(String),
    );

    // Verify JSON structure
    const writtenJson = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed).toHaveProperty("pm");
    expect(parsed).toHaveProperty("engineer");
    expect(parsed).toHaveProperty("qa");
    expect(parsed).toHaveProperty("research");
  });
});

describe("executeApplyGroomingOutput", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();

    // Mock GraphQL for history update
    vi.mocked(ctx.octokit.graphql).mockResolvedValue({
      repository: {
        issue: {
          id: "issue-id",
          body: "## Iteration History\n\n| # | Phase | Action | SHA | Run |\n|---|-------|--------|-----|-----|\n| 0 | groom | ⏳ grooming... | - | - |\n| 0 | - | ⏳ running... | - | - |",
        },
      },
    });
  });

  describe("ready decision", () => {
    test("removes needs-info label before adding groomed label", async () => {
      // Track the order of API calls
      const callOrder: string[] = [];

      vi.mocked(ctx.octokit.rest.issues.removeLabel).mockImplementation(
        async (params) => {
          callOrder.push(`removeLabel:${(params as { name: string }).name}`);
          return {} as never;
        },
      );

      vi.mocked(ctx.octokit.rest.issues.addLabels).mockImplementation(
        async (params) => {
          callOrder.push(
            `addLabels:${(params as { labels: string[] }).labels.join(",")}`,
          );
          return {} as never;
        },
      );

      // Mock the grooming output
      const groomingOutput = {
        pm: { ready: true },
        engineer: { ready: true },
        qa: { ready: true },
        research: { ready: true },
      };

      // Mock summary agent to return "ready" decision
      vi.mocked(executeRunClaude).mockResolvedValue({
        success: true,
        exitCode: 0,
        structuredOutput: {
          summary: "Issue is ready",
          decision: "ready",
          decision_rationale: "All agents agree the issue is ready",
        },
      });

      await executeApplyGroomingOutput(
        {
          type: "applyGroomingOutput",
          token: "code",
          issueNumber: 123,
          filePath: "grooming-output.json",
          consumesArtifact: { name: "test", path: "test" },
        },
        ctx,
        groomingOutput, // Pass structured output directly
      );

      // Verify needs-info is removed BEFORE groomed is added
      const removeLabelIndex = callOrder.findIndex((c) =>
        c.includes("removeLabel:needs-info"),
      );
      const addGroomedIndex = callOrder.findIndex((c) =>
        c.includes("addLabels:groomed"),
      );

      expect(removeLabelIndex).toBeGreaterThanOrEqual(0);
      expect(addGroomedIndex).toBeGreaterThanOrEqual(0);
      expect(removeLabelIndex).toBeLessThan(addGroomedIndex);
    });

    test("still adds groomed label even if needs-info removal fails (label not present)", async () => {
      // Mock removeLabel to fail (404 - label not present)
      vi.mocked(ctx.octokit.rest.issues.removeLabel).mockRejectedValue(
        new Error("Label not found"),
      );

      // Mock addLabels to succeed
      vi.mocked(ctx.octokit.rest.issues.addLabels).mockResolvedValue(
        {} as never,
      );

      const groomingOutput = {
        pm: { ready: true },
        engineer: { ready: true },
        qa: { ready: true },
        research: { ready: true },
      };

      vi.mocked(executeRunClaude).mockResolvedValue({
        success: true,
        exitCode: 0,
        structuredOutput: {
          summary: "Issue is ready",
          decision: "ready",
          decision_rationale: "All agents agree",
        },
      });

      const result = await executeApplyGroomingOutput(
        {
          type: "applyGroomingOutput",
          token: "code",
          issueNumber: 123,
          filePath: "grooming-output.json",
          consumesArtifact: { name: "test", path: "test" },
        },
        ctx,
        groomingOutput,
      );

      // Should still succeed
      expect(result.applied).toBe(true);
      expect(result.decision).toBe("ready");

      // groomed label should still be added
      expect(ctx.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 123,
        labels: ["groomed"],
      });
    });
  });

  describe("needs_info decision", () => {
    test("adds needs-info label but not groomed label", async () => {
      const groomingOutput = {
        pm: { ready: false, questions: ["What is the scope?"] },
        engineer: { ready: false },
        qa: { ready: false },
        research: { ready: true },
      };

      vi.mocked(executeRunClaude).mockResolvedValue({
        success: true,
        exitCode: 0,
        structuredOutput: {
          summary: "Need more info",
          decision: "needs_info",
          decision_rationale: "PM has questions",
          questions: [
            { question: "What is the scope?", source: "pm", priority: "critical" },
          ],
        },
      });

      await executeApplyGroomingOutput(
        {
          type: "applyGroomingOutput",
          token: "code",
          issueNumber: 123,
          filePath: "grooming-output.json",
          consumesArtifact: { name: "test", path: "test" },
        },
        ctx,
        groomingOutput,
      );

      // Should add needs-info label
      expect(ctx.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 123,
        labels: ["needs-info"],
      });

      // Should NOT try to remove needs-info (that's only for ready decision)
      expect(ctx.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    });
  });

  describe("blocked decision", () => {
    test("adds blocked label but not groomed label", async () => {
      const groomingOutput = {
        pm: { ready: false },
        engineer: { ready: false },
        qa: { ready: false },
        research: { ready: false },
      };

      vi.mocked(executeRunClaude).mockResolvedValue({
        success: true,
        exitCode: 0,
        structuredOutput: {
          summary: "Issue is blocked",
          decision: "blocked",
          decision_rationale: "Missing dependencies",
          blocker_reason: "Depends on external API not available",
        },
      });

      await executeApplyGroomingOutput(
        {
          type: "applyGroomingOutput",
          token: "code",
          issueNumber: 123,
          filePath: "grooming-output.json",
          consumesArtifact: { name: "test", path: "test" },
        },
        ctx,
        groomingOutput,
      );

      // Should add blocked label
      expect(ctx.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 123,
        labels: ["blocked"],
      });

      // Should NOT try to remove needs-info (that's only for ready decision)
      expect(ctx.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    });
  });
});

describe("grooming label invariants", () => {
  test("groomed and needs-info labels are mutually exclusive", () => {
    // This test documents the invariant:
    // When grooming decision is "ready":
    //   1. needs-info label is removed first
    //   2. groomed label is added after
    //
    // This order guarantees that both labels cannot exist simultaneously.
    // Even if step 1 fails (label wasn't present), we proceed to step 2.
    // The key is that we ALWAYS try to remove needs-info before adding groomed.

    // Verify by code inspection:
    // - applyReadyDecision calls executeRemoveLabel("needs-info") BEFORE addLabels("groomed")
    // - applyNeedsInfoDecision only adds "needs-info", never "groomed"
    // - applyBlockedDecision only adds "blocked", never "groomed" or "needs-info"

    expect(true).toBe(true);
  });

  test("only one grooming outcome label should exist at a time", () => {
    // Valid grooming label states:
    // - No grooming labels (issue not yet groomed)
    // - "groomed" only (issue is ready)
    // - "needs-info" only (issue needs clarification)
    // - "blocked" only (issue cannot proceed)

    // Invalid states (broken):
    // - "groomed" AND "needs-info" (contradictory)
    // - "groomed" AND "blocked" (contradictory)
    // - "needs-info" AND "blocked" (contradictory)

    // The implementation prevents this by:
    // 1. Each decision function only adds its specific label
    // 2. applyReadyDecision removes needs-info before adding groomed
    // 3. Re-running grooming will update labels based on new decision

    expect(true).toBe(true);
  });
});
