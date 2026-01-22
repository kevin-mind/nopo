import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock @actions/core
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

import {
  executeUpdateProjectStatus,
  executeIncrementIteration,
  executeRecordFailure,
  executeClearFailures,
  executeBlock,
} from "../../../runner/executors/project.js";
import type {
  UpdateProjectStatusAction,
  IncrementIterationAction,
  RecordFailureAction,
  ClearFailuresAction,
  BlockAction,
} from "../../../schemas/index.js";
import type { GitHub } from "@actions/github/lib/utils.js";
import type { RunnerContext } from "../../../runner/runner.js";

type Octokit = InstanceType<typeof GitHub>;

// Create a mock Octokit with the methods we need
function createMockOctokit() {
  return {
    graphql: vi.fn(),
    rest: {
      issues: {},
      pulls: {},
      repos: {},
      git: {},
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

// Helper to create GraphQL response for project item
function createProjectItemResponse(options: {
  issueId?: string;
  itemId?: string;
  status?: string;
  iteration?: number;
  failures?: number;
}) {
  const {
    issueId = "issue-id-123",
    itemId = "item-id-456",
    status = "In progress",
    iteration = 0,
    failures = 0,
  } = options;

  return {
    repository: {
      issue: {
        id: issueId,
        projectItems: {
          nodes: [
            {
              id: itemId,
              project: { id: "project-id-1", number: 1 },
              fieldValues: {
                nodes: [
                  {
                    name: status,
                    field: { name: "Status", id: "status-field-id" },
                  },
                  {
                    number: iteration,
                    field: { name: "Iteration", id: "iteration-field-id" },
                  },
                  {
                    number: failures,
                    field: { name: "Failures", id: "failures-field-id" },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    organization: {
      projectV2: {
        id: "project-id-1",
        fields: {
          nodes: [
            {
              id: "status-field-id",
              name: "Status",
              options: [
                { id: "opt-working", name: "In progress" },
                { id: "opt-review", name: "In review" },
                { id: "opt-done", name: "Done" },
                { id: "opt-blocked", name: "Blocked" },
              ],
            },
            {
              id: "iteration-field-id",
              name: "Iteration",
              dataType: "NUMBER",
            },
            {
              id: "failures-field-id",
              name: "Failures",
              dataType: "NUMBER",
            },
          ],
        },
      },
    },
  };
}

describe("executeUpdateProjectStatus", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("updates project status successfully", async () => {
    // First call: get project item
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({ status: "In progress" }),
    );
    // Second call: update field
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-id-456" } },
    });

    const action: UpdateProjectStatusAction = {
      type: "updateProjectStatus",
      issueNumber: 123,
      status: "In review",
    };

    const result = await executeUpdateProjectStatus(action, ctx);

    expect(result.updated).toBe(true);
    expect(result.previousStatus).toBe("In progress");
    expect(ctx.octokit.graphql).toHaveBeenCalledTimes(2);
  });

  test("returns false when status option not found", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({}),
    );

    const action: UpdateProjectStatusAction = {
      type: "updateProjectStatus",
      issueNumber: 123,
      // Using a status that won't exist in project options
      status: "NonexistentStatus" as UpdateProjectStatusAction["status"],
    };

    const result = await executeUpdateProjectStatus(action, ctx);

    expect(result.updated).toBe(false);
  });

  test("adds issue to project if not already in project", async () => {
    const responseWithoutItem = {
      repository: {
        issue: {
          id: "issue-id-123",
          projectItems: { nodes: [] },
        },
      },
      organization: {
        projectV2: {
          id: "project-id-1",
          fields: {
            nodes: [
              {
                id: "status-field-id",
                name: "Status",
                options: [
                  { id: "opt-working", name: "In progress" },
                  { id: "opt-review", name: "In review" },
                ],
              },
              {
                id: "iteration-field-id",
                name: "Iteration",
                dataType: "NUMBER",
              },
              { id: "failures-field-id", name: "Failures", dataType: "NUMBER" },
            ],
          },
        },
      },
    };

    // First call: get project item (no item)
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(responseWithoutItem);
    // Second call: add issue to project
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      addProjectV2ItemById: { item: { id: "new-item-id" } },
    });
    // Third call: update field
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "new-item-id" } },
    });

    const action: UpdateProjectStatusAction = {
      type: "updateProjectStatus",
      issueNumber: 123,
      status: "In progress",
    };

    const result = await executeUpdateProjectStatus(action, ctx);

    expect(result.updated).toBe(true);
    expect(ctx.octokit.graphql).toHaveBeenCalledTimes(3);
  });
});

describe("executeIncrementIteration", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("increments iteration successfully", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({ iteration: 5 }),
    );
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-id-456" } },
    });

    const action: IncrementIterationAction = {
      type: "incrementIteration",
      issueNumber: 123,
    };

    const result = await executeIncrementIteration(action, ctx);

    expect(result.newIteration).toBe(6);
    expect(ctx.octokit.graphql).toHaveBeenCalledTimes(2);

    // Verify the update call used the new iteration value
    const updateCall = vi.mocked(ctx.octokit.graphql).mock.calls[1];
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toMatchObject({
      value: { number: 6 },
    });
  });

  test("starts from 0 when no previous iteration", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({ iteration: 0 }),
    );
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-id-456" } },
    });

    const action: IncrementIterationAction = {
      type: "incrementIteration",
      issueNumber: 123,
    };

    const result = await executeIncrementIteration(action, ctx);

    expect(result.newIteration).toBe(1);
  });
});

describe("executeRecordFailure", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("records failure by incrementing count", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({ failures: 2 }),
    );
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-id-456" } },
    });

    const action: RecordFailureAction = {
      type: "recordFailure",
      issueNumber: 123,
    };

    const result = await executeRecordFailure(action, ctx);

    expect(result.newFailures).toBe(3);

    const updateCall = vi.mocked(ctx.octokit.graphql).mock.calls[1];
    expect(updateCall?.[1]).toMatchObject({
      value: { number: 3 },
    });
  });

  test("accepts failure type", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({ failures: 0 }),
    );
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-id-456" } },
    });

    const action: RecordFailureAction = {
      type: "recordFailure",
      issueNumber: 123,
      failureType: "ci",
    };

    const result = await executeRecordFailure(action, ctx);

    expect(result.newFailures).toBe(1);
  });
});

describe("executeClearFailures", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("clears failures by setting to 0", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({ failures: 5 }),
    );
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-id-456" } },
    });

    const action: ClearFailuresAction = {
      type: "clearFailures",
      issueNumber: 123,
    };

    const result = await executeClearFailures(action, ctx);

    expect(result.previousFailures).toBe(5);

    const updateCall = vi.mocked(ctx.octokit.graphql).mock.calls[1];
    expect(updateCall?.[1]).toMatchObject({
      value: { number: 0 },
    });
  });
});

describe("executeBlock", () => {
  let ctx: RunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
  });

  test("blocks issue by setting status to Blocked", async () => {
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      createProjectItemResponse({ status: "In progress" }),
    );
    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-id-456" } },
    });

    const action: BlockAction = {
      type: "block",
      issueNumber: 123,
      reason: "Max retries exceeded",
    };

    const result = await executeBlock(action, ctx);

    expect(result.blocked).toBe(true);

    const updateCall = vi.mocked(ctx.octokit.graphql).mock.calls[1];
    expect(updateCall?.[1]).toMatchObject({
      value: { singleSelectOptionId: "opt-blocked" },
    });
  });

  test("returns false when Blocked status not found", async () => {
    const responseWithoutBlocked = {
      repository: {
        issue: {
          id: "issue-id-123",
          projectItems: {
            nodes: [
              {
                id: "item-id-456",
                project: { id: "project-id-1", number: 1 },
                fieldValues: { nodes: [] },
              },
            ],
          },
        },
      },
      organization: {
        projectV2: {
          id: "project-id-1",
          fields: {
            nodes: [
              {
                id: "status-field-id",
                name: "Status",
                options: [
                  { id: "opt-working", name: "In progress" },
                  // No "Blocked" option
                ],
              },
              {
                id: "iteration-field-id",
                name: "Iteration",
                dataType: "NUMBER",
              },
              { id: "failures-field-id", name: "Failures", dataType: "NUMBER" },
            ],
          },
        },
      },
    };

    vi.mocked(ctx.octokit.graphql).mockResolvedValueOnce(
      responseWithoutBlocked,
    );

    const action: BlockAction = {
      type: "block",
      issueNumber: 123,
      reason: "Test",
    };

    const result = await executeBlock(action, ctx);

    expect(result.blocked).toBe(false);
  });
});
