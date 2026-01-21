import { describe, test, expect } from "vitest";
import {
  ActionSchema,
  UpdateProjectStatusActionSchema,
  IncrementIterationActionSchema,
  RecordFailureActionSchema,
  ClearFailuresActionSchema,
  CreateSubIssuesActionSchema,
  CloseIssueActionSchema,
  AppendHistoryActionSchema,
  UpdateHistoryActionSchema,
  AddCommentActionSchema,
  UnassignUserActionSchema,
  CreateBranchActionSchema,
  GitPushActionSchema,
  CreatePRActionSchema,
  ConvertPRToDraftActionSchema,
  MarkPRReadyActionSchema,
  RequestReviewActionSchema,
  MergePRActionSchema,
  RunClaudeActionSchema,
  StopActionSchema,
  BlockActionSchema,
  LogActionSchema,
  NoOpActionSchema,
  createAction,
  isTerminalAction,
  shouldStopOnError,
  ACTION_TYPES,
} from "../../schemas/actions.js";

describe("UpdateProjectStatusActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "updateProjectStatus", issueNumber: 123, status: "Working" };
    expect(UpdateProjectStatusActionSchema.parse(action)).toEqual(action);
  });

  test("accepts optional id", () => {
    const action = {
      type: "updateProjectStatus",
      issueNumber: 1,
      status: "Done",
      id: "550e8400-e29b-41d4-a716-446655440000",
    };
    expect(UpdateProjectStatusActionSchema.parse(action).id).toBeDefined();
  });

  test("rejects invalid status", () => {
    expect(() =>
      UpdateProjectStatusActionSchema.parse({
        type: "updateProjectStatus",
        issueNumber: 1,
        status: "InvalidStatus",
      })
    ).toThrow();
  });

  test("rejects non-positive issue number", () => {
    expect(() =>
      UpdateProjectStatusActionSchema.parse({
        type: "updateProjectStatus",
        issueNumber: 0,
        status: "Working",
      })
    ).toThrow();
  });
});

describe("IncrementIterationActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "incrementIteration", issueNumber: 42 };
    expect(IncrementIterationActionSchema.parse(action)).toEqual(action);
  });
});

describe("RecordFailureActionSchema", () => {
  test("parses action without failure type", () => {
    const action = { type: "recordFailure", issueNumber: 1 };
    expect(RecordFailureActionSchema.parse(action)).toEqual(action);
  });

  test("accepts failure types", () => {
    const types = ["ci", "workflow", "review"];
    for (const failureType of types) {
      const action = { type: "recordFailure", issueNumber: 1, failureType };
      expect(RecordFailureActionSchema.parse(action).failureType).toBe(failureType);
    }
  });
});

describe("ClearFailuresActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "clearFailures", issueNumber: 99 };
    expect(ClearFailuresActionSchema.parse(action)).toEqual(action);
  });
});

describe("CreateSubIssuesActionSchema", () => {
  test("parses valid action with phases", () => {
    const action = {
      type: "createSubIssues",
      parentIssueNumber: 100,
      phases: [
        { title: "Phase 1", body: "## Todos\n- [ ] Task 1" },
        { title: "Phase 2", body: "## Todos\n- [ ] Task 2" },
      ],
    };
    expect(CreateSubIssuesActionSchema.parse(action)).toEqual(action);
  });

  test("requires at least one phase", () => {
    expect(() =>
      CreateSubIssuesActionSchema.parse({
        type: "createSubIssues",
        parentIssueNumber: 1,
        phases: [],
      })
    ).toThrow();
  });

  test("requires non-empty title", () => {
    expect(() =>
      CreateSubIssuesActionSchema.parse({
        type: "createSubIssues",
        parentIssueNumber: 1,
        phases: [{ title: "", body: "Body" }],
      })
    ).toThrow();
  });
});

describe("CloseIssueActionSchema", () => {
  test("parses with default reason", () => {
    const action = { type: "closeIssue", issueNumber: 50 };
    const parsed = CloseIssueActionSchema.parse(action);
    expect(parsed.reason).toBe("completed");
  });

  test("accepts not_planned reason", () => {
    const action = { type: "closeIssue", issueNumber: 50, reason: "not_planned" };
    expect(CloseIssueActionSchema.parse(action).reason).toBe("not_planned");
  });
});

describe("AppendHistoryActionSchema", () => {
  test("parses minimal action", () => {
    const action = {
      type: "appendHistory",
      issueNumber: 1,
      phase: "Phase 1",
      message: "Started implementation",
    };
    expect(AppendHistoryActionSchema.parse(action)).toEqual(action);
  });

  test("accepts optional commitSha and runLink", () => {
    const action = {
      type: "appendHistory",
      issueNumber: 1,
      phase: "Phase 1",
      message: "Pushed code",
      commitSha: "abc123",
      runLink: "https://github.com/run/456",
    };
    const parsed = AppendHistoryActionSchema.parse(action);
    expect(parsed.commitSha).toBe("abc123");
    expect(parsed.runLink).toBe("https://github.com/run/456");
  });
});

describe("UpdateHistoryActionSchema", () => {
  test("parses valid action", () => {
    const action = {
      type: "updateHistory",
      issueNumber: 1,
      matchIteration: 5,
      matchPhase: "Phase 1",
      matchPattern: "In progress",
      newMessage: "Completed",
    };
    expect(UpdateHistoryActionSchema.parse(action)).toEqual(action);
  });
});

describe("AddCommentActionSchema", () => {
  test("parses valid action", () => {
    const action = {
      type: "addComment",
      issueNumber: 123,
      body: "This is a comment",
    };
    expect(AddCommentActionSchema.parse(action)).toEqual(action);
  });
});

describe("UnassignUserActionSchema", () => {
  test("parses valid action", () => {
    const action = {
      type: "unassignUser",
      issueNumber: 1,
      username: "nopo-bot",
    };
    expect(UnassignUserActionSchema.parse(action)).toEqual(action);
  });

  test("rejects empty username", () => {
    expect(() =>
      UnassignUserActionSchema.parse({
        type: "unassignUser",
        issueNumber: 1,
        username: "",
      })
    ).toThrow();
  });
});

describe("CreateBranchActionSchema", () => {
  test("parses with defaults", () => {
    const action = { type: "createBranch", branchName: "feature/new" };
    const parsed = CreateBranchActionSchema.parse(action);
    expect(parsed.baseBranch).toBe("main");
  });

  test("accepts custom base branch", () => {
    const action = { type: "createBranch", branchName: "hotfix", baseBranch: "release/1.0" };
    expect(CreateBranchActionSchema.parse(action).baseBranch).toBe("release/1.0");
  });
});

describe("GitPushActionSchema", () => {
  test("parses with default force=false", () => {
    const action = { type: "gitPush", branchName: "feature/test" };
    const parsed = GitPushActionSchema.parse(action);
    expect(parsed.force).toBe(false);
  });

  test("accepts force=true", () => {
    const action = { type: "gitPush", branchName: "feature/test", force: true };
    expect(GitPushActionSchema.parse(action).force).toBe(true);
  });
});

describe("CreatePRActionSchema", () => {
  test("parses with defaults", () => {
    const action = {
      type: "createPR",
      title: "Fix bug",
      body: "Fixes #123",
      branchName: "fix/bug",
      issueNumber: 123,
    };
    const parsed = CreatePRActionSchema.parse(action);
    expect(parsed.baseBranch).toBe("main");
    expect(parsed.draft).toBe(true);
  });

  test("accepts non-draft PR", () => {
    const action = {
      type: "createPR",
      title: "Feature",
      body: "Body",
      branchName: "feature",
      issueNumber: 1,
      draft: false,
    };
    expect(CreatePRActionSchema.parse(action).draft).toBe(false);
  });
});

describe("ConvertPRToDraftActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "convertPRToDraft", prNumber: 42 };
    expect(ConvertPRToDraftActionSchema.parse(action)).toEqual(action);
  });
});

describe("MarkPRReadyActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "markPRReady", prNumber: 42 };
    expect(MarkPRReadyActionSchema.parse(action)).toEqual(action);
  });
});

describe("RequestReviewActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "requestReview", prNumber: 42, reviewer: "nopo-bot" };
    expect(RequestReviewActionSchema.parse(action)).toEqual(action);
  });
});

describe("MergePRActionSchema", () => {
  test("parses with default squash", () => {
    const action = { type: "mergePR", prNumber: 42 };
    const parsed = MergePRActionSchema.parse(action);
    expect(parsed.mergeMethod).toBe("squash");
  });

  test("accepts merge methods", () => {
    const methods = ["merge", "squash", "rebase"];
    for (const mergeMethod of methods) {
      const action = { type: "mergePR", prNumber: 1, mergeMethod };
      expect(MergePRActionSchema.parse(action).mergeMethod).toBe(mergeMethod);
    }
  });
});

describe("RunClaudeActionSchema", () => {
  test("parses minimal action", () => {
    const action = {
      type: "runClaude",
      prompt: "Implement the feature",
      issueNumber: 123,
    };
    expect(RunClaudeActionSchema.parse(action)).toEqual(action);
  });

  test("accepts allowed tools", () => {
    const action = {
      type: "runClaude",
      prompt: "Test",
      issueNumber: 1,
      allowedTools: ["Read", "Write", "Bash"],
    };
    const parsed = RunClaudeActionSchema.parse(action);
    expect(parsed.allowedTools).toEqual(["Read", "Write", "Bash"]);
  });

  test("accepts worktree path", () => {
    const action = {
      type: "runClaude",
      prompt: "Test",
      issueNumber: 1,
      worktree: "/tmp/worktree-123",
    };
    expect(RunClaudeActionSchema.parse(action).worktree).toBe("/tmp/worktree-123");
  });

  test("rejects empty prompt", () => {
    expect(() =>
      RunClaudeActionSchema.parse({
        type: "runClaude",
        prompt: "",
        issueNumber: 1,
      })
    ).toThrow();
  });
});

describe("StopActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "stop", reason: "All tasks completed" };
    expect(StopActionSchema.parse(action)).toEqual(action);
  });

  test("rejects empty reason", () => {
    expect(() => StopActionSchema.parse({ type: "stop", reason: "" })).toThrow();
  });
});

describe("BlockActionSchema", () => {
  test("parses valid action", () => {
    const action = { type: "block", issueNumber: 1, reason: "Max retries exceeded" };
    expect(BlockActionSchema.parse(action)).toEqual(action);
  });
});

describe("LogActionSchema", () => {
  test("parses with default level", () => {
    const action = { type: "log", message: "Debug info" };
    const parsed = LogActionSchema.parse(action);
    expect(parsed.level).toBe("info");
  });

  test("accepts all log levels", () => {
    const levels = ["debug", "info", "warning", "error"];
    for (const level of levels) {
      const action = { type: "log", level, message: "Test" };
      expect(LogActionSchema.parse(action).level).toBe(level);
    }
  });
});

describe("NoOpActionSchema", () => {
  test("parses without reason", () => {
    const action = { type: "noop" };
    expect(NoOpActionSchema.parse(action).type).toBe("noop");
  });

  test("accepts reason", () => {
    const action = { type: "noop", reason: "No work needed" };
    expect(NoOpActionSchema.parse(action).reason).toBe("No work needed");
  });
});

describe("ActionSchema (discriminated union)", () => {
  test("discriminates by type field", () => {
    const actions = [
      { type: "updateProjectStatus", issueNumber: 1, status: "Working" },
      { type: "incrementIteration", issueNumber: 1 },
      { type: "stop", reason: "Done" },
      { type: "noop" },
    ];
    for (const action of actions) {
      expect(ActionSchema.parse(action).type).toBe(action.type);
    }
  });

  test("rejects unknown action type", () => {
    expect(() => ActionSchema.parse({ type: "unknownAction", data: "test" })).toThrow();
  });

  test("validates action-specific fields", () => {
    // This should fail because status is required for updateProjectStatus
    expect(() =>
      ActionSchema.parse({ type: "updateProjectStatus", issueNumber: 1 })
    ).toThrow();
  });
});

describe("ACTION_TYPES constant", () => {
  test("includes all action types", () => {
    expect(ACTION_TYPES).toContain("updateProjectStatus");
    expect(ACTION_TYPES).toContain("runClaude");
    expect(ACTION_TYPES).toContain("stop");
    expect(ACTION_TYPES).toContain("noop");
  });

  test("has correct length", () => {
    // Count of all action types
    expect(ACTION_TYPES.length).toBe(23);
  });
});

describe("createAction helper", () => {
  test("creates typed action", () => {
    const action = createAction("updateProjectStatus", { issueNumber: 1, status: "Working" });
    expect(action.type).toBe("updateProjectStatus");
    expect(action.issueNumber).toBe(1);
    expect(action.status).toBe("Working");
  });

  test("creates stop action", () => {
    const action = createAction("stop", { reason: "Test complete" });
    expect(action.type).toBe("stop");
    expect(action.reason).toBe("Test complete");
  });

  test("creates noop action", () => {
    const action = createAction("noop", {});
    expect(action.type).toBe("noop");
  });
});

describe("isTerminalAction", () => {
  test("returns true for stop action", () => {
    const action = { type: "stop" as const, reason: "Done" };
    expect(isTerminalAction(action)).toBe(true);
  });

  test("returns true for block action", () => {
    const action = { type: "block" as const, issueNumber: 1, reason: "Max failures" };
    expect(isTerminalAction(action)).toBe(true);
  });

  test("returns false for other actions", () => {
    const actions = [
      { type: "updateProjectStatus" as const, issueNumber: 1, status: "Working" as const },
      { type: "runClaude" as const, prompt: "Test", issueNumber: 1 },
      { type: "noop" as const },
    ];
    for (const action of actions) {
      expect(isTerminalAction(action)).toBe(false);
    }
  });
});

describe("shouldStopOnError", () => {
  test("returns true for critical actions", () => {
    const criticalTypes = ["runClaude", "createPR", "mergePR", "createSubIssues", "block"];
    for (const type of criticalTypes) {
      expect(shouldStopOnError(type as any)).toBe(true);
    }
  });

  test("returns false for non-critical actions", () => {
    const nonCriticalTypes = [
      "updateProjectStatus",
      "incrementIteration",
      "appendHistory",
      "log",
      "noop",
    ];
    for (const type of nonCriticalTypes) {
      expect(shouldStopOnError(type as any)).toBe(false);
    }
  });
});
