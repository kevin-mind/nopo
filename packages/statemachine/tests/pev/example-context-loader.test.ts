import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExampleContextLoader } from "../../src/machines/example/context.js";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import {
  mockExampleContext,
  mockExampleNormalizedEvent,
  mockExampleIssue,
  mockIssueStateIssueData,
  mockIssueStateLinkedPR,
  mockIssueStateSubIssueData,
} from "./mock-factories.js";

vi.mock("@more/issue-state", () => ({
  parseIssue: vi.fn(),
  createExtractor:
    (
      schema: { parse: (value: unknown) => unknown },
      transform: (data: unknown) => unknown,
    ) =>
    (data: unknown) =>
      schema.parse(transform(data)),
  createMutator:
    (
      schema: { parse: (value: unknown) => unknown },
      mutate: (input: unknown, data: unknown) => unknown,
    ) =>
    (input: unknown, data: unknown) =>
      mutate(schema.parse(input), data),
  parseMarkdown: vi.fn(() => ({ type: "root", children: [] })),
  serializeMarkdown: vi.fn(() => ""),
}));

const OCTOKIT: OctokitLike = {
  graphql: async <T>(): Promise<T> => {
    throw new Error("graphql should not be called in mocked parseIssue tests");
  },
  rest: {
    issues: {
      update: vi.fn(async () => ({})),
      addLabels: vi.fn(async () => ({})),
      removeLabel: vi.fn(async () => ({})),
      setLabels: vi.fn(async () => ({})),
      createComment: vi.fn(async () => ({ data: { id: 1 } })),
      updateComment: vi.fn(async () => ({})),
      listComments: vi.fn(async () => ({ data: [] })),
      listForRepo: vi.fn(async () => ({ data: [] })),
      addAssignees: vi.fn(async () => ({})),
      removeAssignees: vi.fn(async () => ({})),
    },
    pulls: {
      list: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async () => ({ data: { number: 1 } })),
      requestReviewers: vi.fn(async () => ({})),
      createReview: vi.fn(async () => ({})),
    },
  },
};

beforeEach(() => {
  vi.mocked(parseIssue).mockReset();
});

describe("ExampleContextLoader", () => {
  it("returns null for non-positive issue numbers", async () => {
    const loader = new ExampleContextLoader();
    const ok = await loader.load({
      trigger: "issue-assigned",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 0 }),
    });
    const loaded = loader.toContext();
    expect(ok).toBe(false);
    expect(loaded).toBeNull();
  });

  it("prefers event CI/review values over seed values", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({ number: 42 }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const ok = await loader.load({
      trigger: "workflow-run-completed",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({
        result: "failure",
        decision: "CHANGES_REQUESTED",
      }),
      seed: {
        issue: mockExampleIssue({ number: 42 }),
        ciResult: "success",
        reviewDecision: "APPROVED",
      },
    });
    expect(ok).toBe(true);
    const loaded = loader.toContext();
    expect(loaded?.ciResult).toBe("failure");
    expect(loaded?.reviewDecision).toBe("CHANGES_REQUESTED");
  });

  it("falls back to seed CI/review when event values are invalid", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({ number: 42 }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const ok = await loader.load({
      trigger: "workflow-run-completed",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({
        result: "not-a-real-result",
        decision: "NOT_A_DECISION",
      }),
      seed: {
        issue: mockExampleIssue({ number: 42 }),
        ciResult: "success",
        reviewDecision: "APPROVED",
      },
    });
    expect(ok).toBe(true);
    const loaded = loader.toContext();
    expect(loaded?.ciResult).toBe("success");
    expect(loaded?.reviewDecision).toBe("APPROVED");
  });

  it("prefers explicit options for comment/branch fields over seed", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          branch: "feature/from-parser",
        }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const ok = await loader.load({
      trigger: "issue-comment",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent(),
      commentContextType: "pr",
      commentContextDescription: "from explicit option",
      branch: "feature/explicit",
      seed: {
        issue: mockExampleIssue({ number: 42 }),
        commentContextType: "issue",
        commentContextDescription: "from seed",
        branch: "feature/seed",
      },
    });
    expect(ok).toBe(true);
    const loaded = loader.toContext();
    expect(loaded?.commentContextType).toBe("pr");
    expect(loaded?.commentContextDescription).toBe("from explicit option");
    expect(loaded?.branch).toBe("feature/explicit");
    expect(loaded?.hasBranch).toBe(true);
  });

  it("uses deterministic defaults for bot username and base issue", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({ number: 777, projectStatus: "Ready" }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const ok = await loader.load({
      trigger: "issue-assigned",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 777 }),
    });
    expect(ok).toBe(true);
    const loaded = loader.toContext();
    expect(loaded?.botUsername).toBe("nopo-bot");
    expect(loaded?.issue.number).toBe(777);
    expect(loaded?.issue.projectStatus).toBe("In progress");
    expect(loaded?.hasPR).toBe(false);
    expect(loaded?.hasBranch).toBe(false);
  });

  it("maps PR-derived CI/review when event metadata is absent", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          pr: mockIssueStateLinkedPR({
            number: 1,
            state: "OPEN",
            isDraft: false,
            title: "PR",
            headRef: "feat",
            baseRef: "main",
            ciStatus: "FAILURE",
            reviewDecision: "REVIEW_REQUIRED",
          }),
        }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const ok = await loader.load({
      trigger: "pr-review-submitted",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent(),
    });
    expect(ok).toBe(true);
    const loaded = loader.toContext();
    expect(loaded?.ciResult).toBe("failure");
    expect(loaded?.reviewDecision).toBe("COMMENTED");
    expect(loaded?.hasPR).toBe(true);
  });

  it("toState applies context updates through mutators", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          projectStatus: "Backlog",
          branch: null,
        }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const ok = await loader.load({
      trigger: "issue-edited",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent(),
    });
    expect(ok).toBe(true);

    loader.toState({
      issue: mockExampleIssue({
        number: 42,
        projectStatus: "In progress",
        labels: ["triaged"],
      }),
      branch: "feature/42",
      pr: {
        number: 8,
        state: "OPEN",
        isDraft: false,
        title: "PR",
        headRef: "feature/42",
        baseRef: "main",
        labels: [],
        reviews: [],
      },
    });

    const raw = loader.getState();
    expect(raw?.issue.projectStatus).toBe("Ready");
    expect(raw?.issue.labels).toEqual(["triaged"]);
    expect(raw?.issue.branch).toBe("feature/42");
    expect(raw?.issue.pr?.number).toBe(8);
  });

  it("repository methods update loaded state consistently", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          projectStatus: "Backlog",
          labels: ["existing"],
          subIssues: [
            mockIssueStateSubIssueData({
              number: 100,
              projectStatus: "In progress",
              state: "OPEN",
            }),
          ],
          hasSubIssues: true,
        }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const ok = await loader.load({
      trigger: "issue-edited",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent(),
    });
    expect(ok).toBe(true);

    loader.setIssueStatus("Blocked");
    loader.addIssueLabels(["triaged", "existing"]);
    loader.reconcileSubIssues([100, 200]);

    const context = loader.toContext();
    expect(context?.issue.projectStatus).toBe("Blocked");
    expect(context?.issue.labels).toEqual(["existing", "triaged"]);
    expect(context?.issue.subIssues).toEqual([
      { number: 100, projectStatus: "In progress", state: "OPEN" },
      { number: 200, projectStatus: "Backlog", state: "OPEN" },
    ]);
    expect(context?.issue.hasSubIssues).toBe(true);
  });

  it("refreshFromRunnerContext returns current context when octokit is missing", async () => {
    const current = mockExampleContext({
      owner: "owner",
      repo: "repo",
      issue: mockExampleIssue({ number: 42 }),
    });
    const refreshed = await ExampleContextLoader.refreshFromRunnerContext(
      {
        token: "token",
        owner: "owner",
        repo: "repo",
      },
      current,
    );
    expect(refreshed).toBe(current);
  });

  it("refreshFromRunnerContext reloads context with valid octokit", async () => {
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          labels: ["from-refresh"],
          projectStatus: "Ready",
        }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const current = mockExampleContext({
      trigger: "issue-groom",
      owner: "owner",
      repo: "repo",
      issue: mockExampleIssue({ number: 42, labels: [] }),
    });
    const refreshed = await ExampleContextLoader.refreshFromRunnerContext(
      {
        token: "token",
        owner: "owner",
        repo: "repo",
        octokit: OCTOKIT,
      },
      current,
    );
    expect(refreshed).not.toBe(current);
    expect(refreshed.issue.labels).toEqual(["from-refresh"]);
    expect(refreshed.issue.projectStatus).toBe("In progress");
    expect(refreshed.repository).toBeDefined();
  });

  it("refreshFromRunnerContext returns current when parse/load fails", async () => {
    vi.mocked(parseIssue).mockRejectedValue(new Error("parse failed"));
    const current = mockExampleContext({
      owner: "owner",
      repo: "repo",
      issue: mockExampleIssue({ number: 42 }),
    });
    const refreshed = await ExampleContextLoader.refreshFromRunnerContext(
      {
        token: "token",
        owner: "owner",
        repo: "repo",
        octokit: OCTOKIT,
      },
      current,
    );
    expect(refreshed).toBe(current);
  });

  it("save persists loaded state and reports readiness", async () => {
    const loader = new ExampleContextLoader();
    const update = vi.fn(async () => {});
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({ number: 42 }),
        parentIssue: null,
      },
      update,
    });
    const ok = await loader.load({
      trigger: "issue-edited",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent(),
    });
    expect(ok).toBe(true);
    loader.setIssueStatus("Done");
    const saved = await loader.save();
    expect(saved).toBe(true);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ projectStatus: "Done" }),
      }),
    );
  });

  it("save returns false when state is not loaded", async () => {
    const loader = new ExampleContextLoader();
    await expect(loader.save()).resolves.toBe(false);
  });

  it("load() returns false and resets state when parseIssue throws", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockRejectedValue(new Error("API error"));
    const ok = await loader.load({
      trigger: "issue-assigned",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 42 }),
    });
    expect(ok).toBe(false);
    expect(loader.toContext()).toBeNull();
    expect(loader.getState()).toBeNull();
    await expect(loader.save()).resolves.toBe(false);
  });

  it("load() returns false for negative issue number without calling parseIssue", async () => {
    const loader = new ExampleContextLoader();
    const ok = await loader.load({
      trigger: "issue-assigned",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: -1 }),
    });
    expect(ok).toBe(false);
    expect(loader.toContext()).toBeNull();
    expect(vi.mocked(parseIssue)).not.toHaveBeenCalled();
  });

  it("load() returns false for NaN issue number without calling parseIssue", async () => {
    const loader = new ExampleContextLoader();
    const ok = await loader.load({
      trigger: "issue-assigned",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: NaN }),
    });
    expect(ok).toBe(false);
    expect(loader.toContext()).toBeNull();
    expect(vi.mocked(parseIssue)).not.toHaveBeenCalled();
  });

  it("save propagates persistence errors", async () => {
    const loader = new ExampleContextLoader();
    const update = vi.fn(async () => {
      throw new Error("persist failed");
    });
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({ number: 42 }),
        parentIssue: null,
      },
      update,
    });
    const ok = await loader.load({
      trigger: "issue-edited",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent(),
    });
    expect(ok).toBe(true);
    await expect(loader.save()).rejects.toThrow("persist failed");
  });
});
