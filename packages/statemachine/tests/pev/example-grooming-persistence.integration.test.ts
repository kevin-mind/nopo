import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import { ExampleContextLoader } from "../../src/machines/example/context.js";
import { createClaudeGroomingService } from "../../src/machines/example/services.js";
import { exampleMachine } from "../../src/machines/example/machine.js";
import {
  mockExampleNormalizedEvent,
  mockIssueStateIssueData,
} from "./mock-factories.js";

vi.mock("@more/claude", () => ({
  resolvePrompt: vi.fn(),
  executeClaudeSDK: vi.fn(),
}));

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
    throw new Error(
      "graphql should not be called in grooming integration test",
    );
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

describe("grooming integration persistence flow", () => {
  beforeEach(() => {
    vi.mocked(resolvePrompt).mockReset();
    vi.mocked(executeClaudeSDK).mockReset();
    vi.mocked(parseIssue).mockReset();
  });

  it("runs grooming through Claude service and persists labels + sub-issues", async () => {
    const update = vi.fn(async () => {});
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          labels: ["triaged"],
          projectStatus: "Backlog",
        }),
        parentIssue: null,
      },
      update,
    });
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "grooming prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        grooming: {
          labels_to_add: ["needs-spec"],
          suggested_sub_issues: [{ number: 501 }, { number: 502 }],
        },
        implementation_plan: "Split into backend and frontend",
      },
    });

    const loader = new ExampleContextLoader();
    const loaded = await loader.load({
      trigger: "issue-groom",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 42 }),
    });
    expect(loaded).toBe(true);

    const domain = loader.toContext();
    expect(domain).not.toBeNull();
    if (!domain) throw new Error("Expected loaded domain context");
    domain.services = {
      ...domain.services,
      grooming: createClaudeGroomingService(),
    };

    const actor = createActor(exampleMachine, {
      input: {
        domain,
        maxTransitions: 20,
        runnerCtx: {
          token: "token",
          owner: "owner",
          repo: "repo",
        },
      },
    });
    actor.start();
    actor.send({ type: "DETECT" });
    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 5000,
    });

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "appendHistory",
      "runClaudeGrooming",
      "applyGroomingOutput",
      "reconcileSubIssues",
    ]);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({
          labels: expect.arrayContaining(["triaged", "groomed", "needs-spec"]),
          subIssues: expect.arrayContaining([
            expect.objectContaining({ number: 501 }),
            expect.objectContaining({ number: 502 }),
          ]),
        }),
      }),
    );
  });

  it("routes to actionFailure when Claude grooming output is malformed", async () => {
    const update = vi.fn(async () => {});
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          labels: ["triaged"],
          projectStatus: "Backlog",
        }),
        parentIssue: null,
      },
      update,
    });
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "grooming prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        grooming: {
          labels_to_add: ["needs-spec"],
          suggested_sub_issues: [{ number: -1 }],
        },
        implementation_plan: "bad",
      },
    });

    const loader = new ExampleContextLoader();
    await loader.load({
      trigger: "issue-groom",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 42 }),
    });
    const domain = loader.toContext();
    expect(domain).not.toBeNull();
    if (!domain) throw new Error("Expected loaded domain context");
    domain.services = {
      ...domain.services,
      grooming: createClaudeGroomingService(),
    };

    const actor = createActor(exampleMachine, {
      input: {
        domain,
        maxTransitions: 20,
        runnerCtx: {
          token: "token",
          owner: "owner",
          repo: "repo",
        },
      },
    });
    actor.start();
    actor.send({ type: "DETECT" });
    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 5000,
    });

    expect(String(snap.value)).toBe("done");
    expect(snap.context.error).toBeTruthy();
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "appendHistory",
      "appendHistory",
    ]);
    expect(update).not.toHaveBeenCalled();
  });
});
