import { describe, it, expect, vi } from "vitest";
import { updateIssue } from "../src/update-issue.js";
import type { OctokitLike } from "../src/client.js";
import type { IssueStateData, IssueData } from "../src/schemas/index.js";
import { parseMarkdown } from "../src/markdown/ast.js";

function makeIssue(overrides: Partial<IssueData> = {}): IssueData {
  return {
    number: 1,
    title: "Test Issue",
    state: "OPEN",
    bodyAst: parseMarkdown("Description"),
    projectStatus: "In progress",
    iteration: 1,
    failures: 0,
    assignees: ["user1"],
    labels: ["bug"],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: "claude/issue/1",
    pr: null,
    parentIssueNumber: null,
    ...overrides,
  };
}

function makeState(issue: IssueData): IssueStateData {
  return {
    owner: "test-owner",
    repo: "test-repo",
    issue,
    parentIssue: null,
  };
}

function createMockOctokit(): OctokitLike {
  return {
    graphql: vi.fn(),
    rest: {
      issues: {
        update: vi.fn(),
        addLabels: vi.fn(),
        removeLabel: vi.fn(),
        createComment: vi.fn(),
        addAssignees: vi.fn(),
        removeAssignees: vi.fn(),
        setLabels: vi.fn(),
        updateComment: vi.fn(),
        listComments: vi.fn(async () => ({ data: [] })),
        listForRepo: vi.fn(async () => ({ data: [] })),
      },
      pulls: {
        list: vi.fn(async () => ({ data: [] })),
        create: vi.fn(async () => ({ data: { number: 1 } })),
        requestReviewers: vi.fn(),
        createReview: vi.fn(),
      },
    },
  };
}

describe("updateIssue", () => {
  it("does nothing when no changes", async () => {
    const octokit = createMockOctokit();
    const original = makeState(makeIssue());
    const updated = makeState(makeIssue());

    await updateIssue(original, updated, octokit);

    expect(octokit.rest.issues.update).not.toHaveBeenCalled();
    expect(octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  it("updates title", async () => {
    const octokit = createMockOctokit();
    const original = makeState(makeIssue());
    const updated = makeState(makeIssue({ title: "New Title" }));

    await updateIssue(original, updated, octokit);

    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        title: "New Title",
      }),
    );
  });

  it("adds labels", async () => {
    const octokit = createMockOctokit();
    const original = makeState(makeIssue({ labels: ["bug"] }));
    const updated = makeState(makeIssue({ labels: ["bug", "enhancement"] }));

    await updateIssue(original, updated, octokit);

    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 1,
      labels: ["enhancement"],
    });
  });

  it("removes labels one at a time", async () => {
    const octokit = createMockOctokit();
    const original = makeState(makeIssue({ labels: ["bug", "enhancement"] }));
    const updated = makeState(makeIssue({ labels: ["bug"] }));

    await updateIssue(original, updated, octokit);

    expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 1,
      name: "enhancement",
    });
  });

  it("adds and removes assignees", async () => {
    const octokit = createMockOctokit();
    const original = makeState(makeIssue({ assignees: ["user1"] }));
    const updated = makeState(makeIssue({ assignees: ["user2"] }));

    await updateIssue(original, updated, octokit);

    expect(octokit.rest.issues.addAssignees).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 1,
      assignees: ["user2"],
    });
    expect(octokit.rest.issues.removeAssignees).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 1,
      assignees: ["user1"],
    });
  });

  it("updates state (close issue)", async () => {
    const octokit = createMockOctokit();
    const original = makeState(makeIssue({ state: "OPEN" }));
    const updated = makeState(makeIssue({ state: "CLOSED" }));

    await updateIssue(original, updated, octokit);

    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "closed",
      }),
    );
  });
});
