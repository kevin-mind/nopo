import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { Action } from "../../schemas/index.js";

// Mock @actions/core
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

// Import after mocks
import {
  executeActions,
  createRunnerContext,
  logRunnerSummary,
  filterActions,
  countActionsByType,
  type RunnerContext,
  type RunnerResult,
} from "../../runner/runner.js";

// Create mock Octokit
function createMockOctokit() {
  return {
    graphql: vi.fn(),
    rest: {
      issues: {
        update: vi.fn(),
        createComment: vi.fn(),
        removeAssignees: vi.fn(),
      },
      pulls: {
        create: vi.fn(),
        requestReviewers: vi.fn(),
        merge: vi.fn(),
      },
      repos: {
        getBranch: vi.fn(),
      },
      git: {
        getRef: vi.fn(),
        createRef: vi.fn(),
      },
    },
  } as unknown as RunnerContext["octokit"];
}

describe("createRunnerContext", () => {
  test("creates context with defaults", () => {
    const octokit = createMockOctokit();
    const ctx = createRunnerContext(octokit, "owner", "repo", 123);

    expect(ctx.octokit).toBe(octokit);
    expect(ctx.owner).toBe("owner");
    expect(ctx.repo).toBe("repo");
    expect(ctx.projectNumber).toBe(123);
    expect(ctx.serverUrl).toBe("https://github.com");
    expect(ctx.dryRun).toBeUndefined();
  });

  test("creates context with options", () => {
    const octokit = createMockOctokit();
    const ctx = createRunnerContext(octokit, "org", "project", 456, {
      dryRun: true,
      serverUrl: "https://ghes.example.com",
    });

    expect(ctx.dryRun).toBe(true);
    expect(ctx.serverUrl).toBe("https://ghes.example.com");
  });

  test("uses GITHUB_SERVER_URL environment variable", () => {
    const originalEnv = process.env.GITHUB_SERVER_URL;
    process.env.GITHUB_SERVER_URL = "https://custom.github.com";

    const octokit = createMockOctokit();
    const ctx = createRunnerContext(octokit, "owner", "repo", 1);

    expect(ctx.serverUrl).toBe("https://custom.github.com");

    process.env.GITHUB_SERVER_URL = originalEnv;
  });
});

describe("executeActions", () => {
  let mockOctokit: ReturnType<typeof createMockOctokit>;
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOctokit = createMockOctokit();
    ctx = createRunnerContext(mockOctokit, "test-owner", "test-repo", 1);
  });

  test("executes noop action successfully", async () => {
    const actions: Action[] = [{ type: "noop" }];

    const result = await executeActions(actions, ctx);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.success).toBe(true);
    expect(result.stoppedEarly).toBe(false);
  });

  test("executes log action with different levels", async () => {
    const actions: Action[] = [
      { type: "log", level: "debug", message: "Debug message" },
      { type: "log", level: "info", message: "Info message" },
      { type: "log", level: "warning", message: "Warning message" },
      { type: "log", level: "error", message: "Error message" },
    ];

    const result = await executeActions(actions, ctx);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(4);
    expect(result.results.every((r) => r.success)).toBe(true);
  });

  test("skips actions in dry run mode", async () => {
    const dryRunCtx = createRunnerContext(mockOctokit, "owner", "repo", 1, {
      dryRun: true,
    });

    const actions: Action[] = [
      { type: "noop", reason: "Test" },
      { type: "log", level: "info", message: "Test" },
    ];

    const result = await executeActions(actions, dryRunCtx);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.skipped)).toBe(true);
  });

  test("stops execution on stop action", async () => {
    const actions: Action[] = [
      { type: "noop" },
      { type: "stop", reason: "Done" },
      { type: "noop" }, // Should not execute
    ];

    const result = await executeActions(actions, ctx);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.stoppedEarly).toBe(true);
    expect(result.stopReason).toBe("Done");
  });

  test("handles invalid action", async () => {
    const actions = [
      { type: "invalidType" as any },
    ];

    const result = await executeActions(actions, ctx);

    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toBeDefined();
    expect(result.stoppedEarly).toBe(true);
    expect(result.stopReason).toBe("Invalid action");
  });

  test("continues on non-critical error with stopOnError=false", async () => {
    const actions: Action[] = [
      { type: "noop" },
      { type: "log", level: "info", message: "Continued after error" },
    ];

    const result = await executeActions(actions, ctx, { stopOnError: false });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  test("logs actions when logActions=true", async () => {
    const core = await import("@actions/core");
    const actions: Action[] = [{ type: "noop" }];

    await executeActions(actions, ctx, { logActions: true });

    expect(core.info).toHaveBeenCalledWith("Executing action: noop");
  });

  test("does not log actions when logActions=false", async () => {
    const core = await import("@actions/core");
    vi.clearAllMocks();

    const actions: Action[] = [{ type: "noop" }];

    await executeActions(actions, ctx, { logActions: false });

    // Check that "Executing action:" was not called
    const calls = vi.mocked(core.info).mock.calls;
    const hasExecutingLog = calls.some((call) =>
      call[0]?.toString().startsWith("Executing action:")
    );
    expect(hasExecutingLog).toBe(false);
  });

  test("tracks execution duration", async () => {
    const actions: Action[] = [{ type: "noop" }];

    const result = await executeActions(actions, ctx);

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.results[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles empty action array", async () => {
    const result = await executeActions([], ctx);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.stoppedEarly).toBe(false);
  });
});

describe("filterActions", () => {
  const actions: Action[] = [
    { type: "noop" },
    { type: "log", level: "info", message: "Test 1" },
    { type: "noop", reason: "Another noop" },
    { type: "log", level: "debug", message: "Test 2" },
    { type: "stop", reason: "Done" },
  ];

  test("filters actions by type", () => {
    const noops = filterActions(actions, "noop");
    expect(noops).toHaveLength(2);
    expect(noops.every((a) => a.type === "noop")).toBe(true);
  });

  test("filters log actions", () => {
    const logs = filterActions(actions, "log");
    expect(logs).toHaveLength(2);
    expect(logs.every((a) => a.type === "log")).toBe(true);
  });

  test("returns empty array when no matches", () => {
    const blocks = filterActions(actions, "block");
    expect(blocks).toHaveLength(0);
  });
});

describe("countActionsByType", () => {
  test("counts actions by type", () => {
    const actions: Action[] = [
      { type: "noop" },
      { type: "log", level: "info", message: "Test 1" },
      { type: "noop", reason: "Another" },
      { type: "log", level: "debug", message: "Test 2" },
      { type: "stop", reason: "Done" },
    ];

    const counts = countActionsByType(actions);

    expect(counts.noop).toBe(2);
    expect(counts.log).toBe(2);
    expect(counts.stop).toBe(1);
  });

  test("handles empty array", () => {
    const counts = countActionsByType([]);
    expect(counts).toEqual({});
  });
});

describe("logRunnerSummary", () => {
  let core: typeof import("@actions/core");

  beforeEach(async () => {
    vi.clearAllMocks();
    core = await import("@actions/core");
  });

  test("logs summary of successful results", () => {
    const result: RunnerResult = {
      success: true,
      results: [
        {
          action: { type: "noop" },
          success: true,
          skipped: false,
          durationMs: 10,
        },
        {
          action: { type: "log", level: "info", message: "Test" },
          success: true,
          skipped: false,
          durationMs: 5,
        },
      ],
      totalDurationMs: 15,
      stoppedEarly: false,
    };

    logRunnerSummary(result);

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Runner Summary"));
    expect(core.info).toHaveBeenCalledWith("Total actions: 2");
    expect(core.info).toHaveBeenCalledWith("Successful: 2");
    expect(core.info).toHaveBeenCalledWith("Failed: 0");
    expect(core.info).toHaveBeenCalledWith("Skipped: 0");
    expect(core.info).toHaveBeenCalledWith("Total duration: 15ms");
  });

  test("logs summary with failures", () => {
    const result: RunnerResult = {
      success: false,
      results: [
        {
          action: { type: "noop" },
          success: false,
          skipped: false,
          error: new Error("Test error"),
          durationMs: 10,
        },
      ],
      totalDurationMs: 10,
      stoppedEarly: true,
      stopReason: "Error occurred",
    };

    logRunnerSummary(result);

    expect(core.info).toHaveBeenCalledWith("Failed: 1");
    expect(core.info).toHaveBeenCalledWith("Stopped early: Error occurred");
    expect(core.error).toHaveBeenCalledWith("    Error: Test error");
  });

  test("logs summary with skipped actions", () => {
    const result: RunnerResult = {
      success: true,
      results: [
        {
          action: { type: "noop" },
          success: true,
          skipped: true,
          durationMs: 0,
        },
      ],
      totalDurationMs: 0,
      stoppedEarly: false,
    };

    logRunnerSummary(result);

    expect(core.info).toHaveBeenCalledWith("Skipped: 1");
  });
});
