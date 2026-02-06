import { describe, it, expect, vi } from "vitest";
import { createIssue } from "../src/create-issue.js";
import type { OctokitLike } from "../src/client.js";

function createMockOctokit(
  options: {
    repoId?: string;
    projectInfo?: {
      projectId: string;
      statusFieldId: string;
      statusOptions: Record<string, string>;
      iterationFieldId: string;
      failuresFieldId: string;
    };
  } = {},
): OctokitLike {
  const { repoId = "repo-123", projectInfo } = options;

  let issueCounter = 1;

  return {
    graphql: vi.fn(async (query: string) => {
      // GetRepoId
      if (query.includes("GetRepoId")) {
        return { repository: { id: repoId } };
      }
      // CreateIssue
      if (query.includes("CreateIssue")) {
        const id = `issue-${issueCounter}`;
        const number = issueCounter++;
        return { createIssue: { issue: { id, number } } };
      }
      // AddSubIssue
      if (query.includes("AddSubIssue")) {
        return { addSubIssue: { issue: { id: "parent" } } };
      }
      // GetProjectFields
      if (query.includes("GetProjectFields")) {
        if (!projectInfo) {
          return { organization: null };
        }
        return {
          organization: {
            projectV2: {
              id: projectInfo.projectId,
              fields: {
                nodes: [
                  {
                    id: projectInfo.statusFieldId,
                    name: "Status",
                    options: Object.entries(projectInfo.statusOptions).map(
                      ([name, id]) => ({ name, id }),
                    ),
                  },
                  {
                    id: projectInfo.iterationFieldId,
                    name: "Iteration",
                    dataType: "NUMBER",
                  },
                  {
                    id: projectInfo.failuresFieldId,
                    name: "Failures",
                    dataType: "NUMBER",
                  },
                ],
              },
            },
          },
        };
      }
      // AddIssueToProject
      if (query.includes("addProjectV2ItemById")) {
        return { addProjectV2ItemById: { item: { id: "item-123" } } };
      }
      // UpdateProjectField
      if (query.includes("updateProjectV2ItemFieldValue")) {
        return {
          updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-123" } },
        };
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

describe("createIssue", () => {
  it("creates a basic issue", async () => {
    const octokit = createMockOctokit();

    const result = await createIssue(
      "owner",
      "repo",
      {
        title: "Test Issue",
        body: "Issue description",
      },
      { octokit },
    );

    expect(result.issueNumber).toBe(1);
    expect(result.subIssueNumbers).toEqual([]);

    // Verify CreateIssue was called
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("CreateIssue"),
      expect.objectContaining({
        repositoryId: "repo-123",
        title: "Test Issue",
        body: "Issue description",
      }),
    );
  });

  it("creates issue with labels and assignees", async () => {
    const octokit = createMockOctokit();

    await createIssue(
      "owner",
      "repo",
      {
        title: "Test Issue",
        labels: ["bug", "priority:high"],
        assignees: ["user1", "user2"],
      },
      { octokit },
    );

    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 1,
      labels: ["bug", "priority:high"],
    });

    expect(octokit.rest.issues.addAssignees).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 1,
      assignees: ["user1", "user2"],
    });
  });

  it("creates issue with sub-issues", async () => {
    const octokit = createMockOctokit();

    const result = await createIssue(
      "owner",
      "repo",
      {
        title: "Parent Issue",
        subIssues: [
          { title: "[Phase 1]: Setup", body: "Setup tasks" },
          { title: "[Phase 2]: Implementation", body: "Implementation tasks" },
        ],
      },
      { octokit },
    );

    expect(result.issueNumber).toBe(1);
    expect(result.subIssueNumbers).toEqual([2, 3]);

    // Verify AddSubIssue was called for each sub-issue
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("AddSubIssue"),
      expect.objectContaining({
        parentId: "issue-1",
        childId: "issue-2",
      }),
    );
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("AddSubIssue"),
      expect.objectContaining({
        parentId: "issue-1",
        childId: "issue-3",
      }),
    );
  });

  it("creates issue with comments", async () => {
    const octokit = createMockOctokit();

    await createIssue(
      "owner",
      "repo",
      {
        title: "Test Issue",
        comments: [{ body: "First comment" }, { body: "Second comment" }],
      },
      { octokit },
    );

    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(2);
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 1,
      body: "First comment",
    });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 1,
      body: "Second comment",
    });
  });

  it("adds issue to project with fields", async () => {
    const octokit = createMockOctokit({
      projectInfo: {
        projectId: "project-1",
        statusFieldId: "status-field-1",
        statusOptions: {
          "In progress": "status-option-in-progress",
          Done: "status-option-done",
        },
        iterationFieldId: "iteration-field-1",
        failuresFieldId: "failures-field-1",
      },
    });

    await createIssue(
      "owner",
      "repo",
      { title: "Test Issue" },
      {
        octokit,
        projectNumber: 1,
        projectFields: {
          status: "In progress",
          iteration: 5,
          failures: 0,
        },
      },
    );

    // Verify issue was added to project
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("addProjectV2ItemById"),
      expect.objectContaining({
        projectId: "project-1",
        contentId: "issue-1",
      }),
    );

    // Verify project fields were updated
    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("updateProjectV2ItemFieldValue"),
      expect.objectContaining({
        projectId: "project-1",
        itemId: "item-123",
        fieldId: "status-field-1",
        value: { singleSelectOptionId: "status-option-in-progress" },
      }),
    );

    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("updateProjectV2ItemFieldValue"),
      expect.objectContaining({
        projectId: "project-1",
        itemId: "item-123",
        fieldId: "iteration-field-1",
        value: { number: 5 },
      }),
    );

    expect(octokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("updateProjectV2ItemFieldValue"),
      expect.objectContaining({
        projectId: "project-1",
        itemId: "item-123",
        fieldId: "failures-field-1",
        value: { number: 0 },
      }),
    );
  });

  it("handles sub-issues with their own labels and assignees", async () => {
    const octokit = createMockOctokit();

    await createIssue(
      "owner",
      "repo",
      {
        title: "Parent Issue",
        subIssues: [
          {
            title: "[Phase 1]: Setup",
            labels: ["phase-1"],
            assignees: ["dev1"],
          },
        ],
      },
      { octokit },
    );

    // Sub-issue labels
    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 2, // Sub-issue number
      labels: ["phase-1"],
    });

    // Sub-issue assignees
    expect(octokit.rest.issues.addAssignees).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 2, // Sub-issue number
      assignees: ["dev1"],
    });
  });
});
