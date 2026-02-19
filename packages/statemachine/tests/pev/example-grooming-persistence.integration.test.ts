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

let nextSubIssueNumber = 500;
vi.mock("@more/issue-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@more/issue-state")>();
  return {
    ...actual,
    parseIssue: vi.fn(),
    addSubIssueToParent: vi.fn(async () => ({
      issueNumber: nextSubIssueNumber++,
      issueId: `ID_${nextSubIssueNumber}`,
    })),
  };
});

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
    nextSubIssueNumber = 500;
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
    // Mock 4 agents + summary (5 calls total)
    vi.mocked(executeClaudeSDK)
      // Engineer
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: {
          implementation_plan: "Split into backend and frontend",
          recommended_phases: [
            {
              phase_number: 1,
              title: "Backend",
              description: "Backend work",
            },
            {
              phase_number: 2,
              title: "Frontend",
              description: "Frontend work",
            },
          ],
        },
      })
      // PM
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: { pm_analysis: "Approved" },
      })
      // QA
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: { qa_analysis: "Tests needed" },
      })
      // Research
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: { research: "No blockers" },
      })
      // Summary
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: {
          summary: "Split into backend and frontend",
          decision: "ready",
          decision_rationale: "All clear",
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
        maxCycles: 1,
        runnerCtx: {
          token: "token",
          owner: "owner",
          repo: "repo",
        },
      },
    });
    actor.start();
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
    // The reconcileSubIssues action calls createSubIssue on the loader,
    // but addSubIssueToParent is mocked, so we just verify the persist was called
    expect(update).toHaveBeenCalled();
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
    // First agent fails with bad output
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: false,
      exitCode: 1,
      output: "",
      error: "malformed output",
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
        maxCycles: 1,
        runnerCtx: {
          token: "token",
          owner: "owner",
          repo: "repo",
        },
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
    expect(update).not.toHaveBeenCalled();
  });
});
