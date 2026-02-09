import { describe, it, expect, vi } from "vitest";
import { parseIssue } from "../src/parse-issue.js";
import type { OctokitLike } from "../src/client.js";
import type {
  IssueResponse,
  PRResponse,
  BranchResponse,
} from "../src/graphql/types.js";

function createMockOctokit(
  issueResponse: IssueResponse,
  branchResponse: BranchResponse = { repository: { ref: null } },
  prResponse: PRResponse = { repository: { pullRequests: { nodes: [] } } },
): OctokitLike {
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mock graphql function for testing
    graphql: vi.fn(async (query: string) => {
      if (query.includes("GetIssueWithProject")) {
        return issueResponse;
      }
      if (query.includes("CheckBranchExists")) {
        return branchResponse;
      }
      if (query.includes("GetPRForBranch")) {
        return prResponse;
      }
      return {};
    }) as OctokitLike["graphql"],
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

const MINIMAL_ISSUE_RESPONSE: IssueResponse = {
  repository: {
    issue: {
      id: "I_123",
      number: 42,
      title: "Test Issue",
      body: "Description here\n\n## Approach\n\nUse TDD.",
      state: "OPEN",
      assignees: { nodes: [{ login: "nopo-bot" }] },
      labels: { nodes: [{ name: "bug" }, { name: "enhancement" }] },
      parent: null,
      projectItems: {
        nodes: [
          {
            id: "PI_1",
            project: { id: "P_1", number: 5 },
            fieldValues: {
              nodes: [
                { name: "In progress", field: { name: "Status", id: "F_1" } },
                { number: 3, field: { name: "Iteration", id: "F_2" } },
                { number: 1, field: { name: "Failures", id: "F_3" } },
              ],
            },
          },
        ],
      },
      subIssues: { nodes: [] },
      comments: {
        nodes: [
          {
            id: "C_1",
            author: { login: "human" },
            body: "Please fix this",
            createdAt: "2026-01-22T19:04:52Z",
          },
        ],
      },
    },
  },
};

describe("parseIssue", () => {
  it("parses a basic issue with bodyAst", async () => {
    const octokit = createMockOctokit(MINIMAL_ISSUE_RESPONSE);

    const { data } = await parseIssue("owner", "repo", 42, {
      octokit,
      projectNumber: 5,
      fetchPRs: false,
    });

    expect(data.owner).toBe("owner");
    expect(data.repo).toBe("repo");
    expect(data.issue.number).toBe(42);
    expect(data.issue.title).toBe("Test Issue");
    expect(data.issue.state).toBe("OPEN");
    expect(data.issue.projectStatus).toBe("In progress");
    expect(data.issue.iteration).toBe(3);
    expect(data.issue.failures).toBe(1);
    expect(data.issue.assignees).toEqual(["nopo-bot"]);
    expect(data.issue.labels).toEqual(["bug", "enhancement"]);
    expect(data.issue.hasSubIssues).toBe(false);
    expect(data.issue.bodyAst.type).toBe("root");
    expect(data.issue.bodyAst.children.length).toBeGreaterThan(0);
    expect(data.issue.comments).toHaveLength(1);
    expect(data.issue.comments[0]!.isBot).toBe(false);
    expect(data.parentIssue).toBeNull();
  });

  it("parses issue with sub-issues", async () => {
    const response: IssueResponse = {
      repository: {
        issue: {
          ...MINIMAL_ISSUE_RESPONSE.repository!.issue,
          subIssues: {
            nodes: [
              {
                id: "SI_1",
                number: 43,
                title: "[Phase 1]: Setup",
                body: "- [ ] Create files",
                state: "OPEN",
                projectItems: {
                  nodes: [
                    {
                      project: { number: 5 },
                      fieldValues: {
                        nodes: [
                          { name: "In progress", field: { name: "Status" } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };

    const octokit = createMockOctokit(response);
    const { data } = await parseIssue("owner", "repo", 42, {
      octokit,
      projectNumber: 5,
      fetchPRs: false,
    });

    expect(data.issue.hasSubIssues).toBe(true);
    expect(data.issue.subIssues).toHaveLength(1);
    expect(data.issue.subIssues[0]!.number).toBe(43);
    expect(data.issue.subIssues[0]!.projectStatus).toBe("In progress");
    expect(data.issue.subIssues[0]!.branch).toBe("claude/issue/42/phase-1");
    expect(data.issue.subIssues[0]!.bodyAst.type).toBe("root");
  });

  it("throws for non-existent issue", async () => {
    const octokit = createMockOctokit({
      repository: { issue: undefined },
    });

    await expect(parseIssue("owner", "repo", 999, { octokit })).rejects.toThrow(
      "Issue #999 not found",
    );
  });

  it("returns an update function", async () => {
    const octokit = createMockOctokit(MINIMAL_ISSUE_RESPONSE);

    const { data, update } = await parseIssue("owner", "repo", 42, {
      octokit,
      projectNumber: 5,
      fetchPRs: false,
    });

    expect(typeof update).toBe("function");

    // Modify data and call update — should call issues.update
    data.issue.title = "Updated Title";
    await update(data);

    expect(octokit.rest.issues.update).toHaveBeenCalled();
  });
});
