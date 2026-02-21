import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import { ExampleContextLoader } from "../../src/machines/example/context.js";
import { createClaudeTriageService } from "../../src/machines/example/services.js";
import { exampleMachine } from "../../src/machines/example/machine.js";
import {
  mockExampleNormalizedEvent,
  mockExampleServices,
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
    throw new Error("graphql should not be called in triage integration test");
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

describe("triage integration persistence flow", () => {
  beforeEach(() => {
    vi.mocked(resolvePrompt).mockReset();
    vi.mocked(executeClaudeSDK).mockReset();
    vi.mocked(parseIssue).mockReset();
  });

  it("runs triage through Claude service and persists issue-state update", async () => {
    const update = vi.fn(async () => {});
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          labels: [],
          projectStatus: "Backlog",
        }),
        parentIssue: null,
      },
      update,
    });
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "triage prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        triage: {
          type: "enhancement",
          topics: ["automation"],
          needs_info: false,
        },
        initial_approach: "Automate labeling and status transitions.",
      },
    });

    const loader = new ExampleContextLoader();
    const loaded = await loader.load({
      trigger: "issue-triage",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 42 }),
    });
    expect(loaded).toBe(true);

    const domain = loader.toContext();
    expect(domain).not.toBeNull();
    if (!domain) {
      throw new Error("Expected loaded domain context");
    }
    const actor = createActor(exampleMachine, {
      input: {
        domain,
        maxCycles: 1,
        runnerCtx: {
          token: "token",
          owner: "owner",
          repo: "repo",
        },
        services: mockExampleServices({
          triage: createClaudeTriageService(),
        }),
      },
    });
    actor.start();
    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 5000,
    });

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "appendHistory",
      "runClaudeTriage",
      "applyTriageOutput",
      "updateStatus",
    ]);
    expect(vi.mocked(executeClaudeSDK)).toHaveBeenCalledOnce();
    // Auto-persist at queue drain: status updated to "Triaged", labels applied
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({
          labels: expect.arrayContaining([
            "type:enhancement",
            "topic:automation",
          ]),
          projectStatus: "Triaged",
        }),
      }),
    );
  });

  it("completes all actions even when persistence update throws (auto-persist error is non-fatal)", async () => {
    const update = vi.fn(async () => {
      throw new Error("persist failed");
    });
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          labels: [],
          projectStatus: "Backlog",
        }),
        parentIssue: null,
      },
      update,
    });
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "triage prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        triage: {
          type: "enhancement",
          topics: ["automation"],
          needs_info: false,
        },
        initial_approach: "Automate labeling and status transitions.",
      },
    });

    const loader = new ExampleContextLoader();
    await loader.load({
      trigger: "issue-triage",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 42 }),
    });
    const domain = loader.toContext();
    expect(domain).not.toBeNull();
    if (!domain) {
      throw new Error("Expected loaded domain context");
    }
    const actor = createActor(exampleMachine, {
      input: {
        domain,
        maxCycles: 1,
        runnerCtx: {
          token: "token",
          owner: "owner",
          repo: "repo",
        },
        services: mockExampleServices({
          triage: createClaudeTriageService(),
        }),
      },
    });
    actor.start();
    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 5000,
    });

    // All queue actions complete; auto-persist failure at queue drain is non-fatal
    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "appendHistory",
      "runClaudeTriage",
      "applyTriageOutput",
      "updateStatus",
    ]);
  });

  it("routes to actionFailure when Claude output is malformed", async () => {
    const update = vi.fn(async () => {});
    vi.mocked(parseIssue).mockResolvedValue({
      data: {
        owner: "owner",
        repo: "repo",
        issue: mockIssueStateIssueData({
          number: 42,
          labels: [],
          projectStatus: "Backlog",
        }),
        parentIssue: null,
      },
      update,
    });
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "triage prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        triage: {
          type: "invalid-type",
          topics: ["automation"],
          needs_info: false,
        },
        initial_approach: "bad",
      },
    });

    const loader = new ExampleContextLoader();
    await loader.load({
      trigger: "issue-triage",
      octokit: OCTOKIT,
      owner: "owner",
      repo: "repo",
      event: mockExampleNormalizedEvent({ issueNumber: 42 }),
    });
    const domain = loader.toContext();
    expect(domain).not.toBeNull();
    if (!domain) {
      throw new Error("Expected loaded domain context");
    }
    const actor = createActor(exampleMachine, {
      input: {
        domain,
        maxCycles: 1,
        runnerCtx: {
          token: "token",
          owner: "owner",
          repo: "repo",
        },
        services: mockExampleServices({
          triage: createClaudeTriageService(),
        }),
      },
    });
    actor.start();
    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 5000,
    });

    expect(String(snap.value)).toBe("done");
    expect(snap.context.error).toBeTruthy();
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "appendHistory",
      "appendHistory",
    ]);
    // Auto-persist at queue drain still calls update (non-fatal persist)
    expect(update).toHaveBeenCalled();
  });
});
