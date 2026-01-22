import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock @actions/core
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

// Mock @actions/exec
vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));

import * as exec from "@actions/exec";
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

describe("executeRunClaude", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("executes Claude CLI successfully", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const action: RunClaudeAction = {
      type: "runClaude",
      prompt: "Implement feature",
      issueNumber: 123,
    };

    const result = await executeRunClaude(action, ctx);

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(exec.exec).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "--print",
        "--dangerously-skip-permissions",
        "Implement feature", // Prompt as positional argument (last)
      ]),
      expect.objectContaining({
        ignoreReturnCode: true,
      }),
    );
  });

  test("passes allowed tools to CLI", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const action: RunClaudeAction = {
      type: "runClaude",
      prompt: "Test",
      issueNumber: 1,
      allowedTools: ["Read", "Write", "Bash"],
    };

    await executeRunClaude(action, ctx);

    expect(exec.exec).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "--allowedTools",
        "Read",
        "--allowedTools",
        "Write",
        "--allowedTools",
        "Bash",
      ]),
      expect.any(Object),
    );
  });

  test("uses worktree as working directory", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const action: RunClaudeAction = {
      type: "runClaude",
      prompt: "Test",
      issueNumber: 1,
      worktree: "/tmp/worktree-123",
    };

    await executeRunClaude(action, ctx);

    expect(exec.exec).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({
        cwd: "/tmp/worktree-123",
      }),
    );
  });

  test("sets environment variables", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const action: RunClaudeAction = {
      type: "runClaude",
      prompt: "Test",
      issueNumber: 1,
    };

    await executeRunClaude(action, ctx);

    expect(exec.exec).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          GITHUB_REPOSITORY: "test-owner/test-repo",
          GITHUB_SERVER_URL: "https://github.com",
          CI: "true",
        }),
      }),
    );
  });

  test("handles non-zero exit code", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const action: RunClaudeAction = {
      type: "runClaude",
      prompt: "Test",
      issueNumber: 1,
    };

    const result = await executeRunClaude(action, ctx);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });

  test("handles exec exception", async () => {
    vi.mocked(exec.exec).mockRejectedValueOnce(new Error("Command not found"));

    const action: RunClaudeAction = {
      type: "runClaude",
      prompt: "Test",
      issueNumber: 1,
    };

    const result = await executeRunClaude(action, ctx);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("Command not found");
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
