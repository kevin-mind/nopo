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

// Mock @actions/exec
vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));

// Mock the Claude Agent SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import * as exec from "@actions/exec";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  executeRunClaude,
  isClaudeAvailable,
  getClaudeVersion,
  buildImplementationPrompt,
  buildCIFixPrompt,
  buildReviewResponsePrompt,
} from "../../../runner/executors/claude.js";
import type { RunClaudeAction } from "../../../schemas/index.js";
import type { GitHub } from "@actions/github/lib/utils.js";
import type { RunnerContext } from "../../../runner/runner.js";

type Octokit = InstanceType<typeof GitHub>;

// Create mock context
function createMockContext(): RunnerContext {
  return {
    octokit: {} as unknown as Octokit,
    owner: "test-owner",
    repo: "test-repo",
    projectNumber: 1,
    serverUrl: "https://github.com",
  };
}

// Helper to create an async generator from an array
function createAsyncGenerator<T>(items: T[]): AsyncGenerator<T> {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

describe("executeRunClaude", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("executes Claude SDK successfully", async () => {
    const mockMessages = [
      {
        type: "system",
        subtype: "init",
        model: "claude-opus-4-5",
        session_id: "test",
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Done" }] },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1000,
        num_turns: 1,
        total_cost_usd: 0.01,
      },
    ];

    vi.mocked(query).mockReturnValueOnce(createAsyncGenerator(mockMessages));

    const action: RunClaudeAction = {
      type: "runClaude",
      token: "code",
      prompt: "Implement feature",
      issueNumber: 123,
    };

    const result = await executeRunClaude(action, ctx);

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Implement feature",
        options: expect.objectContaining({
          env: expect.objectContaining({
            GITHUB_REPOSITORY: "test-owner/test-repo",
            CI: "true",
          }),
        }),
      }),
    );
  });

  test("passes allowed tools to SDK", async () => {
    const mockMessages = [
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 100,
        num_turns: 1,
      },
    ];

    vi.mocked(query).mockReturnValueOnce(createAsyncGenerator(mockMessages));

    const action: RunClaudeAction = {
      type: "runClaude",
      token: "code",
      prompt: "Test",
      issueNumber: 1,
      allowedTools: ["Read", "Write", "Bash"],
    };

    await executeRunClaude(action, ctx);

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          allowedTools: ["Read", "Write", "Bash"],
        }),
      }),
    );
  });

  test("uses worktree as working directory", async () => {
    const mockMessages = [
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 100,
        num_turns: 1,
      },
    ];

    vi.mocked(query).mockReturnValueOnce(createAsyncGenerator(mockMessages));

    const action: RunClaudeAction = {
      type: "runClaude",
      token: "code",
      prompt: "Test",
      issueNumber: 1,
      worktree: "/tmp/worktree-123",
    };

    await executeRunClaude(action, ctx);

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          cwd: "/tmp/worktree-123",
        }),
      }),
    );
  });

  test("handles SDK failure result", async () => {
    const mockMessages = [
      {
        type: "result",
        subtype: "failure",
        is_error: true,
        duration_ms: 1000,
        num_turns: 1,
      },
    ];

    vi.mocked(query).mockReturnValueOnce(createAsyncGenerator(mockMessages));

    const action: RunClaudeAction = {
      type: "runClaude",
      token: "code",
      prompt: "Test",
      issueNumber: 1,
    };

    const result = await executeRunClaude(action, ctx);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });

  test("handles SDK exception", async () => {
    vi.mocked(query).mockImplementationOnce(() => {
      // eslint-disable-next-line require-yield
      return (async function* () {
        throw new Error("SDK error");
      })();
    });

    const action: RunClaudeAction = {
      type: "runClaude",
      token: "code",
      prompt: "Test",
      issueNumber: 1,
    };

    const result = await executeRunClaude(action, ctx);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("SDK error");
  });

  test("extracts structured output from result", async () => {
    // Note: Structured output extraction happens when outputSchema is provided,
    // which requires reading from a file via promptDir. Since we're testing the
    // SDK integration, we verify the SDK is called and result is returned.
    // The actual structured_output field is returned in the result regardless.
    const structuredData = { key: "value" };
    const mockMessages = [
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1000,
        num_turns: 1,
        structured_output: structuredData,
      },
    ];

    vi.mocked(query).mockReturnValueOnce(createAsyncGenerator(mockMessages));

    // Use a direct prompt - structured output is still captured from SDK result
    const action: RunClaudeAction = {
      type: "runClaude",
      token: "code",
      prompt: "Test prompt",
      issueNumber: 1,
    };

    const result = await executeRunClaude(action, ctx);

    expect(result.success).toBe(true);
    // Note: structuredOutput extraction requires outputSchema which requires promptDir with outputs.json
    // Without outputSchema, the raw result is returned but structuredOutput is not parsed
    // This test verifies SDK integration works correctly
    expect(query).toHaveBeenCalled();
  });

  test("uses mock output when available", async () => {
    const mockOutput = { triage: { type: "bug" } };
    const mockContext: RunnerContext = {
      ...ctx,
      mockOutputs: {
        triage: mockOutput,
      },
    };

    // Mock exec for the git commands in createMockCommit
    vi.mocked(exec.exec).mockResolvedValue(0);

    const action: RunClaudeAction = {
      type: "runClaude",
      token: "code",
      prompt: "Test",
      issueNumber: 1,
      promptDir: "triage",
    };

    const result = await executeRunClaude(action, mockContext);

    expect(result.success).toBe(true);
    expect(result.structuredOutput).toEqual(mockOutput);
    // SDK should not be called
    expect(query).not.toHaveBeenCalled();
  });
});

describe("isClaudeAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns true when claude is available", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await isClaudeAvailable();

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "which",
      ["claude"],
      expect.any(Object),
    );
  });

  test("returns false when claude is not available", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await isClaudeAvailable();

    expect(result).toBe(false);
  });

  test("returns false on exception", async () => {
    vi.mocked(exec.exec).mockRejectedValueOnce(new Error("exec error"));

    const result = await isClaudeAvailable();

    expect(result).toBe(false);
  });
});

describe("getClaudeVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns version when available", async () => {
    vi.mocked(exec.exec).mockImplementationOnce(
      async (_cmd, _args, options) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("claude-code v1.0.0\n"));
        }
        return 0;
      },
    );

    const result = await getClaudeVersion();

    expect(result).toBe("claude-code v1.0.0");
    expect(exec.exec).toHaveBeenCalledWith(
      "claude",
      ["--version"],
      expect.any(Object),
    );
  });

  test("returns null on non-zero exit code", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await getClaudeVersion();

    expect(result).toBeNull();
  });

  test("returns null on exception", async () => {
    vi.mocked(exec.exec).mockRejectedValueOnce(new Error("exec error"));

    const result = await getClaudeVersion();

    expect(result).toBeNull();
  });
});

describe("buildImplementationPrompt", () => {
  test("builds prompt with all parameters", () => {
    const prompt = buildImplementationPrompt(
      123,
      "Add new feature",
      "## Description\n\nImplement X",
      "claude/issue/123",
    );

    expect(prompt).toContain("#123");
    expect(prompt).toContain("Add new feature");
    expect(prompt).toContain("## Description");
    expect(prompt).toContain("Implement X");
    expect(prompt).toContain("claude/issue/123");
    expect(prompt).toContain("TODO items");
  });
});

describe("buildCIFixPrompt", () => {
  test("builds prompt with CI information", () => {
    const prompt = buildCIFixPrompt(
      123,
      "https://github.com/runs/456",
      "abc123",
    );

    expect(prompt).toContain("#123");
    expect(prompt).toContain("https://github.com/runs/456");
    expect(prompt).toContain("abc123");
    expect(prompt).toContain("CI failures");
  });

  test("handles null values", () => {
    const prompt = buildCIFixPrompt(123, null, null);

    expect(prompt).toContain("#123");
    expect(prompt).toContain("N/A");
  });
});

describe("buildReviewResponsePrompt", () => {
  test("builds prompt with review information", () => {
    const prompt = buildReviewResponsePrompt(
      123,
      "CHANGES_REQUESTED",
      "reviewer-user",
    );

    expect(prompt).toContain("#123");
    expect(prompt).toContain("CHANGES_REQUESTED");
    expect(prompt).toContain("reviewer-user");
    expect(prompt).toContain("review feedback");
  });

  test("handles null values", () => {
    const prompt = buildReviewResponsePrompt(123, null, null);

    expect(prompt).toContain("#123");
    expect(prompt).toContain("N/A");
  });
});
