import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock @actions/core
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

import {
  executeCloseIssue,
  executeAppendHistory,
  executeUpdateHistory,
  executeUpdateIssueBody,
  executeAddComment,
  executeUnassignUser,
  executeAssignUser,
  executeCreateSubIssues,
  executeCreatePR,
  executeConvertPRToDraft,
  executeMarkPRReady,
  executeRequestReview,
  executeMergePR,
} from "../../../runner/executors/github.js";
import type {
  CloseIssueAction,
  AppendHistoryAction,
  UpdateHistoryAction,
  UpdateIssueBodyAction,
  AddCommentAction,
  UnassignUserAction,
  AssignUserAction,
  CreateSubIssuesAction,
  CreatePRAction,
  ConvertPRToDraftAction,
  MarkPRReadyAction,
  RequestReviewAction,
  MergePRAction,
} from "../../../schemas/index.js";
import type { GitHub } from "@actions/github/lib/utils.js";
import type { RunnerContext } from "../../../runner/runner.js";

type Octokit = InstanceType<typeof GitHub>;

// Create a mock Octokit with the methods we need
function createMockOctokit() {
  return {
    graphql: vi.fn(),
    rest: {
      issues: {
        update: vi.fn(),
        createComment: vi.fn(),
        removeAssignees: vi.fn(),
        addAssignees: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
      },
      pulls: {
        list: vi.fn(),
        create: vi.fn(),
        requestReviewers: vi.fn(),
        merge: vi.fn(),
      },
    },
  } as unknown as Octokit;
}

// Create mock context with properly typed octokit
function createMockContext(): RunnerContext {
  return {
    octokit: createMockOctokit(),
    owner: "test-owner",
    repo: "test-repo",
    projectNumber: 1,
    serverUrl: "https://github.com",
  };
}

describe("executeCloseIssue", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("closes issue with completed reason", async () => {
    vi.mocked(ctx.octokit.rest.issues.update).mockResolvedValueOnce(
      {} as never,
    );

    const action: CloseIssueAction = {
      type: "closeIssue",
      issueNumber: 123,
      reason: "completed",
    };

    const result = await executeCloseIssue(action, ctx);

    expect(result.closed).toBe(true);
    expect(ctx.octokit.rest.issues.update).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      state: "closed",
      state_reason: "completed",
    });
  });

  test("closes issue with not_planned reason", async () => {
    vi.mocked(ctx.octokit.rest.issues.update).mockResolvedValueOnce(
      {} as never,
    );

    const action: CloseIssueAction = {
      type: "closeIssue",
      issueNumber: 123,
      reason: "not_planned",
    };

    await executeCloseIssue(action, ctx);

    expect(ctx.octokit.rest.issues.update).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      state: "closed",
      state_reason: "not_planned",
    });
  });
});

describe("executeAppendHistory", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("appends history entry to issue body", async () => {
    const existingBody = "## Description\n\nSome text";

    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: {
        issue: {
          id: "issue-id",
          body: existingBody,
        },
      },
    });
    vi.mocked(ctx.octokit.rest.issues.update).mockResolvedValueOnce(
      {} as never,
    );

    const action: AppendHistoryAction = {
      type: "appendHistory",
      issueNumber: 123,
      phase: "Phase 1",
      message: "Started implementation",
    };

    const result = await executeAppendHistory(action, ctx);

    expect(result.appended).toBe(true);
    expect(ctx.octokit.rest.issues.update).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: expect.stringContaining("## Iteration History"),
    });
  });

  test("includes commit SHA and run link when provided", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: {
        issue: {
          id: "issue-id",
          body: "## Description\n\nText",
        },
      },
    });
    vi.mocked(ctx.octokit.rest.issues.update).mockResolvedValueOnce(
      {} as never,
    );

    const action: AppendHistoryAction = {
      type: "appendHistory",
      issueNumber: 123,
      phase: "Phase 1",
      message: "Pushed code",
      commitSha: "abc123",
      runLink: "https://github.com/runs/456",
    };

    await executeAppendHistory(action, ctx);

    const updateCall = vi.mocked(ctx.octokit.rest.issues.update).mock.calls[0];
    expect(updateCall?.[0]?.body).toContain("abc123");
    expect(updateCall?.[0]?.body).toContain("https://github.com/runs/456");
  });
});

describe("executeUpdateHistory", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("updates matching history entry", async () => {
    const existingBody = `## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | In progress | - | - |
`;

    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: {
        issue: {
          id: "issue-id",
          body: existingBody,
        },
      },
    });
    vi.mocked(ctx.octokit.rest.issues.update).mockResolvedValueOnce(
      {} as never,
    );

    const action: UpdateHistoryAction = {
      type: "updateHistory",
      issueNumber: 123,
      matchIteration: 1,
      matchPhase: "1",
      matchPattern: "In progress",
      newMessage: "Completed",
    };

    const result = await executeUpdateHistory(action, ctx);

    expect(result.updated).toBe(true);
    const updateCall = vi.mocked(ctx.octokit.rest.issues.update).mock.calls[0];
    expect(updateCall?.[0]?.body).toContain("Completed");
  });

  test("does not update when no match found", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: {
        issue: {
          id: "issue-id",
          body: "## Iteration History\n\n| # | Phase | Action | SHA | Run |\n|---|-------|--------|-----|-----|",
        },
      },
    });

    const action: UpdateHistoryAction = {
      type: "updateHistory",
      issueNumber: 123,
      matchIteration: 99,
      matchPhase: "99",
      matchPattern: "Not found",
      newMessage: "Updated",
    };

    const result = await executeUpdateHistory(action, ctx);

    expect(result.updated).toBe(false);
    expect(ctx.octokit.rest.issues.update).not.toHaveBeenCalled();
  });
});

describe("executeUpdateIssueBody", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("updates issue body", async () => {
    vi.mocked(ctx.octokit.rest.issues.update).mockResolvedValueOnce(
      {} as never,
    );

    const action: UpdateIssueBodyAction = {
      type: "updateIssueBody",
      issueNumber: 123,
      body: "New body content",
    };

    const result = await executeUpdateIssueBody(action, ctx);

    expect(result.updated).toBe(true);
    expect(ctx.octokit.rest.issues.update).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: "New body content",
    });
  });
});

describe("executeAddComment", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("adds comment to issue", async () => {
    vi.mocked(ctx.octokit.rest.issues.createComment).mockResolvedValueOnce({
      data: { id: 456 },
    } as never);

    const action: AddCommentAction = {
      type: "addComment",
      issueNumber: 123,
      body: "This is a comment",
    };

    const result = await executeAddComment(action, ctx);

    expect(result.commentId).toBe(456);
    expect(ctx.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: "This is a comment",
    });
  });
});

describe("executeUnassignUser", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("unassigns user from issue", async () => {
    vi.mocked(ctx.octokit.rest.issues.removeAssignees).mockResolvedValueOnce(
      {} as never,
    );

    const action: UnassignUserAction = {
      type: "unassignUser",
      issueNumber: 123,
      username: "nopo-bot",
    };

    const result = await executeUnassignUser(action, ctx);

    expect(result.unassigned).toBe(true);
    expect(ctx.octokit.rest.issues.removeAssignees).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      assignees: ["nopo-bot"],
    });
  });
});

describe("executeAssignUser", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("assigns user to issue", async () => {
    vi.mocked(ctx.octokit.rest.issues.addAssignees).mockResolvedValueOnce(
      {} as never,
    );

    const action: AssignUserAction = {
      type: "assignUser",
      issueNumber: 42,
      username: "nopo-bot",
    };

    const result = await executeAssignUser(action, ctx);

    expect(result.assigned).toBe(true);
    expect(ctx.octokit.rest.issues.addAssignees).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 42,
      assignees: ["nopo-bot"],
    });
  });
});

describe("executeCreateSubIssues", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("creates sub-issues and links them to parent", async () => {
    // Get repo ID
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: { id: "repo-id-123" },
    });
    // Get parent issue ID
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: {
        issue: { id: "parent-issue-id" },
      },
    });
    // Create sub-issue 1
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      createIssue: {
        issue: { id: "sub-issue-id-1", number: 201 },
      },
    });
    // Link sub-issue 1
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      addSubIssue: { issue: { id: "parent-issue-id" } },
    });
    // Create sub-issue 2
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      createIssue: {
        issue: { id: "sub-issue-id-2", number: 202 },
      },
    });
    // Link sub-issue 2
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      addSubIssue: { issue: { id: "parent-issue-id" } },
    });

    const action: CreateSubIssuesAction = {
      type: "createSubIssues",
      parentIssueNumber: 100,
      phases: [
        { title: "Setup", body: "## Todos\n- [ ] Task 1" },
        { title: "Implementation", body: "## Todos\n- [ ] Task 2" },
      ],
    };

    const result = await executeCreateSubIssues(action, ctx);

    expect(result.subIssueNumbers).toEqual([201, 202]);
    expect(ctx.octokit.graphql).toHaveBeenCalledTimes(6);
  });

  test("throws when parent issue not found", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: { id: "repo-id-123" },
    });
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: { issue: null },
    });

    const action: CreateSubIssuesAction = {
      type: "createSubIssues",
      parentIssueNumber: 999,
      phases: [{ title: "Test", body: "Body" }],
    };

    await expect(executeCreateSubIssues(action, ctx)).rejects.toThrow(
      "Parent issue #999 not found",
    );
  });
});

describe("executeCreatePR", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("creates draft PR with issue link", async () => {
    // No existing PR
    vi.mocked(ctx.octokit.rest.pulls.list).mockResolvedValueOnce({
      data: [],
    } as never);
    vi.mocked(ctx.octokit.rest.pulls.create).mockResolvedValueOnce({
      data: { number: 42 },
    } as never);

    const action: CreatePRAction = {
      type: "createPR",
      title: "Fix bug",
      body: "This PR fixes a bug",
      branchName: "fix/bug-123",
      baseBranch: "main",
      draft: true,
      issueNumber: 123,
    };

    const result = await executeCreatePR(action, ctx);

    expect(result.prNumber).toBe(42);
    expect(ctx.octokit.rest.pulls.list).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      head: "test-owner:fix/bug-123",
      base: "main",
      state: "open",
    });
    expect(ctx.octokit.rest.pulls.create).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      title: "Fix bug",
      body: "This PR fixes a bug\n\nFixes #123",
      head: "fix/bug-123",
      base: "main",
      draft: true,
    });
  });

  test("returns existing PR instead of creating new one", async () => {
    // Existing PR found
    vi.mocked(ctx.octokit.rest.pulls.list).mockResolvedValueOnce({
      data: [{ number: 99 }],
    } as never);

    const action: CreatePRAction = {
      type: "createPR",
      title: "Fix bug",
      body: "This PR fixes a bug",
      branchName: "fix/bug-123",
      baseBranch: "main",
      draft: true,
      issueNumber: 123,
    };

    const result = await executeCreatePR(action, ctx);

    expect(result.prNumber).toBe(99);
    expect(ctx.octokit.rest.pulls.list).toHaveBeenCalled();
    expect(ctx.octokit.rest.pulls.create).not.toHaveBeenCalled();
  });
});

describe("executeConvertPRToDraft", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("converts PR to draft", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: {
        pullRequest: { id: "pr-id-123" },
      },
    });
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      convertPullRequestToDraft: {
        pullRequest: { id: "pr-id-123", isDraft: true },
      },
    });

    const action: ConvertPRToDraftAction = {
      type: "convertPRToDraft",
      prNumber: 42,
    };

    const result = await executeConvertPRToDraft(action, ctx);

    expect(result.converted).toBe(true);
  });

  test("throws when PR not found", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: { pullRequest: null },
    });

    const action: ConvertPRToDraftAction = {
      type: "convertPRToDraft",
      prNumber: 999,
    };

    await expect(executeConvertPRToDraft(action, ctx)).rejects.toThrow(
      "PR #999 not found",
    );
  });
});

describe("executeMarkPRReady", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("marks PR as ready for review", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      repository: {
        pullRequest: { id: "pr-id-123" },
      },
    });
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      markPullRequestReadyForReview: {
        pullRequest: { id: "pr-id-123", isDraft: false },
      },
    });

    const action: MarkPRReadyAction = {
      type: "markPRReady",
      prNumber: 42,
    };

    const result = await executeMarkPRReady(action, ctx);

    expect(result.ready).toBe(true);
  });
});

describe("executeRequestReview", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("requests reviewer for PR", async () => {
    vi.mocked(ctx.octokit.rest.pulls.requestReviewers).mockResolvedValueOnce(
      {} as never,
    );

    const action: RequestReviewAction = {
      type: "requestReview",
      prNumber: 42,
      reviewer: "nopo-bot",
    };

    const result = await executeRequestReview(action, ctx);

    expect(result.requested).toBe(true);
    expect(ctx.octokit.rest.pulls.requestReviewers).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 42,
      reviewers: ["nopo-bot"],
    });
  });
});

describe("executeMergePR", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("merges PR with squash", async () => {
    vi.mocked(ctx.octokit.rest.pulls.merge).mockResolvedValueOnce({
      data: { merged: true, sha: "merge-sha-123" },
    } as never);

    const action: MergePRAction = {
      type: "mergePR",
      prNumber: 42,
      mergeMethod: "squash",
    };

    const result = await executeMergePR(action, ctx);

    expect(result.merged).toBe(true);
    expect(result.sha).toBe("merge-sha-123");
    expect(ctx.octokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 42,
      merge_method: "squash",
    });
  });

  test("merges PR with merge method", async () => {
    vi.mocked(ctx.octokit.rest.pulls.merge).mockResolvedValueOnce({
      data: { merged: true, sha: "merge-sha-456" },
    } as never);

    const action: MergePRAction = {
      type: "mergePR",
      prNumber: 42,
      mergeMethod: "merge",
    };

    await executeMergePR(action, ctx);

    expect(ctx.octokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 42,
      merge_method: "merge",
    });
  });

  test("merges PR with rebase", async () => {
    vi.mocked(ctx.octokit.rest.pulls.merge).mockResolvedValueOnce({
      data: { merged: true, sha: "rebase-sha-789" },
    } as never);

    const action: MergePRAction = {
      type: "mergePR",
      prNumber: 42,
      mergeMethod: "rebase",
    };

    await executeMergePR(action, ctx);

    expect(ctx.octokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 42,
      merge_method: "rebase",
    });
  });
});
