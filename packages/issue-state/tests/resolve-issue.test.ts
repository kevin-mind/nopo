import { describe, it, expect, vi } from "vitest";
import {
  issueNumberFromPR,
  issueNumberFromBranch,
  parentIssueNumber,
} from "../src/resolve-issue.js";
import type { OctokitLike } from "../src/client.js";
import type {
  PRClosingIssuesResponse,
  BranchClosingIssuesResponse,
  IssueParentResponse,
} from "../src/graphql/types.js";

function createMockOctokit(
  response:
    | PRClosingIssuesResponse
    | BranchClosingIssuesResponse
    | IssueParentResponse,
): OctokitLike {
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mock graphql function for testing
    graphql: vi.fn(async () => response) as OctokitLike["graphql"],
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

describe("issueNumberFromPR", () => {
  it("returns the closing issue number", async () => {
    const octokit = createMockOctokit({
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: [{ number: 100 }],
          },
        },
      },
    });

    const result = await issueNumberFromPR(octokit, "owner", "repo", 5);

    expect(result).toBe(100);
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("GetPRClosingIssues"),
      { owner: "owner", repo: "repo", prNumber: 5 },
    );
  });

  it("returns null when no closing issues", async () => {
    const octokit = createMockOctokit({
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: [],
          },
        },
      },
    });

    const result = await issueNumberFromPR(octokit, "owner", "repo", 5);
    expect(result).toBeNull();
  });

  it("returns null when PR not found", async () => {
    const octokit = createMockOctokit({
      repository: {
        pullRequest: undefined,
      },
    });

    const result = await issueNumberFromPR(octokit, "owner", "repo", 999);
    expect(result).toBeNull();
  });
});

describe("issueNumberFromBranch", () => {
  it("returns the closing issue number from branch PR", async () => {
    const octokit = createMockOctokit({
      repository: {
        pullRequests: {
          nodes: [
            {
              closingIssuesReferences: {
                nodes: [{ number: 200 }],
              },
            },
          ],
        },
      },
    });

    const result = await issueNumberFromBranch(
      octokit,
      "owner",
      "repo",
      "claude/issue/200",
    );

    expect(result).toBe(200);
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("GetBranchClosingIssues"),
      { owner: "owner", repo: "repo", headRef: "claude/issue/200" },
    );
  });

  it("returns null when no PR for branch", async () => {
    const octokit = createMockOctokit({
      repository: {
        pullRequests: {
          nodes: [],
        },
      },
    });

    const result = await issueNumberFromBranch(
      octokit,
      "owner",
      "repo",
      "no-pr-branch",
    );
    expect(result).toBeNull();
  });

  it("returns null when PR exists but no closing issues", async () => {
    const octokit = createMockOctokit({
      repository: {
        pullRequests: {
          nodes: [
            {
              closingIssuesReferences: {
                nodes: [],
              },
            },
          ],
        },
      },
    });

    const result = await issueNumberFromBranch(
      octokit,
      "owner",
      "repo",
      "some-branch",
    );
    expect(result).toBeNull();
  });
});

describe("parentIssueNumber", () => {
  it("returns the parent issue number", async () => {
    const octokit = createMockOctokit({
      repository: {
        issue: {
          id: "I_1",
          body: "sub-issue body",
          parent: { number: 50 },
        },
      },
    });

    const result = await parentIssueNumber(octokit, "owner", "repo", 51);

    expect(result).toBe(50);
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("GetIssueBody"),
      { owner: "owner", repo: "repo", issueNumber: 51 },
    );
  });

  it("returns null when no parent", async () => {
    const octokit = createMockOctokit({
      repository: {
        issue: {
          id: "I_2",
          body: "standalone issue",
          parent: null,
        },
      },
    });

    const result = await parentIssueNumber(octokit, "owner", "repo", 42);
    expect(result).toBeNull();
  });

  it("returns null when issue not found", async () => {
    const octokit = createMockOctokit({
      repository: {
        issue: undefined,
      },
    });

    const result = await parentIssueNumber(octokit, "owner", "repo", 999);
    expect(result).toBeNull();
  });
});
