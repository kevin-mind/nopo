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
  executeCreateBranch,
  executeGitPush,
  checkoutBranch,
  createOrCheckoutBranch,
  getCurrentBranch,
  getCurrentSha,
  hasUncommittedChanges,
  stageAllChanges,
  commit,
  fetch,
  rebase,
} from "../../../runner/executors/git.js";
import type {
  CreateBranchAction,
  GitPushAction,
} from "../../../schemas/index.js";
import type { RunnerContext } from "../../../runner/runner.js";

// Create mock context
function createMockContext(): RunnerContext {
  return {
    octokit: {
      rest: {
        repos: {
          getBranch: vi.fn(),
        },
        git: {
          getRef: vi.fn(),
          createRef: vi.fn(),
        },
      },
    } as any,
    owner: "test-owner",
    repo: "test-repo",
    projectNumber: 1,
    serverUrl: "https://github.com",
  };
}

describe("executeCreateBranch", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("creates new branch when it doesn't exist", async () => {
    // Branch doesn't exist
    vi.mocked(ctx.octokit.rest.repos.getBranch).mockRejectedValueOnce(
      new Error("Not found"),
    );

    // Get base branch SHA
    vi.mocked(ctx.octokit.rest.git.getRef).mockResolvedValueOnce({
      data: { object: { sha: "abc123" } },
    } as any);

    // Create branch succeeds
    vi.mocked(ctx.octokit.rest.git.createRef).mockResolvedValueOnce({} as any);

    const action: CreateBranchAction = {
      type: "createBranch",
      branchName: "feature/new",
      baseBranch: "main",
    };

    const result = await executeCreateBranch(action, ctx);

    expect(result.created).toBe(true);
    expect(ctx.octokit.rest.repos.getBranch).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      branch: "feature/new",
    });
    expect(ctx.octokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      ref: "heads/main",
    });
    expect(ctx.octokit.rest.git.createRef).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      ref: "refs/heads/feature/new",
      sha: "abc123",
    });
  });

  test("does not create branch when it already exists", async () => {
    // Branch exists
    vi.mocked(ctx.octokit.rest.repos.getBranch).mockResolvedValueOnce({
      data: {},
    } as any);

    const action: CreateBranchAction = {
      type: "createBranch",
      branchName: "feature/existing",
      baseBranch: "main",
    };

    const result = await executeCreateBranch(action, ctx);

    expect(result.created).toBe(false);
    expect(ctx.octokit.rest.git.createRef).not.toHaveBeenCalled();
  });
});

describe("executeGitPush", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("pushes branch successfully", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const action: GitPushAction = {
      type: "gitPush",
      branchName: "feature/test",
      force: false,
    };

    const result = await executeGitPush(action, ctx);

    expect(result.pushed).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "feature/test"],
      expect.any(Object),
    );
  });

  test("pushes with force flag", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const action: GitPushAction = {
      type: "gitPush",
      branchName: "feature/test",
      force: true,
    };

    await executeGitPush(action, ctx);

    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "feature/test", "--force"],
      expect.any(Object),
    );
  });

  test("handles push failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const action: GitPushAction = {
      type: "gitPush",
      branchName: "feature/test",
      force: false,
    };

    const result = await executeGitPush(action, ctx);

    expect(result.pushed).toBe(false);
  });
});

describe("checkoutBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("checks out branch successfully", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await checkoutBranch("feature/test");

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["checkout", "feature/test"],
      expect.any(Object),
    );
  });

  test("handles checkout failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await checkoutBranch("nonexistent");

    expect(result).toBe(false);
  });
});

describe("createOrCheckoutBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("checks out existing branch", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await createOrCheckoutBranch("existing-branch");

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledTimes(1);
  });

  test("creates branch from base when checkout fails", async () => {
    // First checkout fails
    vi.mocked(exec.exec).mockResolvedValueOnce(1);
    // Create from base succeeds
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await createOrCheckoutBranch("new-branch", "main");

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledTimes(2);
    expect(exec.exec).toHaveBeenLastCalledWith(
      "git",
      ["checkout", "-b", "new-branch", "origin/main"],
      expect.any(Object),
    );
  });

  test("returns false when both operations fail", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await createOrCheckoutBranch("bad-branch");

    expect(result).toBe(false);
  });
});

describe("getCurrentBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns current branch name", async () => {
    vi.mocked(exec.exec).mockImplementationOnce(
      async (_cmd, _args, options) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("main\n"));
        }
        return 0;
      },
    );

    const result = await getCurrentBranch();

    expect(result).toBe("main");
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      expect.any(Object),
    );
  });

  test("returns null on failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await getCurrentBranch();

    expect(result).toBeNull();
  });
});

describe("getCurrentSha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns current SHA", async () => {
    vi.mocked(exec.exec).mockImplementationOnce(
      async (_cmd, _args, options) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("abc123def456\n"));
        }
        return 0;
      },
    );

    const result = await getCurrentSha();

    expect(result).toBe("abc123def456");
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      expect.any(Object),
    );
  });

  test("returns null on failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await getCurrentSha();

    expect(result).toBeNull();
  });
});

describe("hasUncommittedChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns true when there are changes", async () => {
    vi.mocked(exec.exec).mockImplementationOnce(
      async (_cmd, _args, options) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("M file.txt\n"));
        }
        return 0;
      },
    );

    const result = await hasUncommittedChanges();

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["status", "--porcelain"],
      expect.any(Object),
    );
  });

  test("returns false when there are no changes", async () => {
    vi.mocked(exec.exec).mockImplementationOnce(
      async (_cmd, _args, options) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from(""));
        }
        return 0;
      },
    );

    const result = await hasUncommittedChanges();

    expect(result).toBe(false);
  });
});

describe("stageAllChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("stages all changes successfully", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await stageAllChanges();

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["add", "-A"],
      expect.any(Object),
    );
  });

  test("returns false on failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await stageAllChanges();

    expect(result).toBe(false);
  });
});

describe("commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("commits with message successfully", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await commit("Test commit message");

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "Test commit message"],
      expect.any(Object),
    );
  });

  test("returns false on failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await commit("Test");

    expect(result).toBe(false);
  });
});

describe("fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("fetches from origin by default", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await fetch();

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin"],
      expect.any(Object),
    );
  });

  test("fetches from specified remote", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    await fetch("upstream");

    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["fetch", "upstream"],
      expect.any(Object),
    );
  });

  test("returns false on failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await fetch();

    expect(result).toBe(false);
  });
});

describe("rebase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rebases on branch successfully", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(0);

    const result = await rebase("origin/main");

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      "git",
      ["rebase", "origin/main"],
      expect.any(Object),
    );
  });

  test("returns false on failure", async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(1);

    const result = await rebase("origin/main");

    expect(result).toBe(false);
  });
});
