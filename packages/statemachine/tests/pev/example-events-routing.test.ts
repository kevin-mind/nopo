import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import {
  buildEventFromWorkflow,
  getTriggerEvent,
  type ExampleTrigger,
} from "../../src/machines/example/events.js";
import {
  ExampleContextLoader,
  type ExampleContext,
} from "../../src/machines/example/context.js";
import { exampleMachine } from "../../src/machines/example/machine.js";
import type { ExternalRunnerContext } from "../../src/core/pev/types.js";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import {
  mockExampleContext,
  mockExampleIssue,
  mockExampleServices,
  mockIssueStateIssueData,
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

const RUNNER_CTX: ExternalRunnerContext = {
  token: "test-token",
  owner: "test-owner",
  repo: "test-repo",
};

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

async function runDetect(domain: ExampleContext) {
  const actor = createActor(exampleMachine, {
    input: { domain, maxCycles: 1, runnerCtx: RUNNER_CTX, services: mockExampleServices() },
  });
  actor.start();
  return waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
}

describe("example events", () => {
  it("maps workflow CI results to machine events", () => {
    expect(
      getTriggerEvent({
        trigger: "workflow-run-completed",
        ciResult: "success",
        reviewDecision: null,
      }),
    ).toEqual({ type: "CI_SUCCESS" });

    expect(
      getTriggerEvent({
        trigger: "workflow-run-completed",
        ciResult: "failure",
        reviewDecision: null,
      }),
    ).toEqual({ type: "CI_FAILURE" });
  });

  it("maps review decisions to review events", () => {
    expect(
      getTriggerEvent({
        trigger: "pr-review-submitted",
        ciResult: null,
        reviewDecision: "APPROVED",
      }),
    ).toEqual({ type: "REVIEW_APPROVED" });

    expect(
      getTriggerEvent({
        trigger: "pr-review-submitted",
        ciResult: null,
        reviewDecision: "CHANGES_REQUESTED",
      }),
    ).toEqual({ type: "REVIEW_CHANGES_REQUESTED" });
  });

  it("normalizes workflow fields into an event payload", () => {
    const fields = buildEventFromWorkflow(
      "pr-push",
      {
        issue_number: "42",
        ci_result: "success",
        branch_name: "feature/test",
      },
      "acme",
      "repo",
    );

    expect(fields.event.type).toBe("pr_push");
    expect(fields.event.issueNumber).toBe(42);
    expect(fields.branch).toBe("feature/test");
  });

  it("loads normalized fields into example context loader output", async () => {
    const loader = new ExampleContextLoader();
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "acme",
        repo: "repo",
        issue: mockIssueStateIssueData({ number: 42 }),
        parentIssue: null,
      },
      update: async () => {},
    });
    const fields = buildEventFromWorkflow(
      "workflow-run-completed",
      {
        issue_number: "42",
        ci_result: "success",
        ci_run_url: "https://ci.example/run/1",
        ci_commit_sha: "abc123",
        branch_name: "feature/test",
      },
      "acme",
      "repo",
    );

    const ok = await loader.load({
      trigger: "workflow-run-completed",
      octokit: OCTOKIT,
      owner: "acme",
      repo: "repo",
      event: fields.event,
      ciRunUrl: fields.ciRunUrl,
      branch: fields.branch,
      workflowStartedAt: fields.workflowStartedAt,
      workflowRunUrl: fields.workflowRunUrl,
      seed: {
        issue: mockExampleIssue({ number: 42 }),
      },
    });
    expect(ok).toBe(true);
    const loaded = loader.toContext();

    expect(loaded).not.toBeNull();
    expect(loaded?.ciResult).toBe("success");
    expect(loaded?.ciCommitSha).toBe("abc123");
    expect(loaded?.branch).toBe("feature/test");
  });
});

describe("example routing skeleton", () => {
  const directRoutingCases: Array<{
    trigger: ExampleTrigger;
    expectedState: string;
  }> = [
    { trigger: "issue-closed", expectedState: "done" },
    { trigger: "issue-reset", expectedState: "done" },
    { trigger: "issue-retry", expectedState: "done" },
    { trigger: "issue-comment", expectedState: "done" },
    { trigger: "issue-groom-summary", expectedState: "done" },
    { trigger: "pr-review-requested", expectedState: "done" },
    { trigger: "merge-queue-entered", expectedState: "done" },
    {
      trigger: "deployed-prod-failed",
      expectedState: "done",
    },
  ];

  for (const c of directRoutingCases) {
    it(`routes ${c.trigger} to ${c.expectedState}`, async () => {
      const domain = mockExampleContext({
        trigger: c.trigger,
        owner: "test-owner",
        repo: "test-repo",
        issue: mockExampleIssue({ number: 42 }),
      });

      const snap = await runDetect(domain);
      expect(String(snap.value)).toBe(c.expectedState);
    });
  }
});
