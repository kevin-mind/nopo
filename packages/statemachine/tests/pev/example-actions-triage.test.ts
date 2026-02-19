import { describe, expect, it, vi } from "vitest";
import {
  applyGroomingOutputAction,
  applyIterationOutputAction,
  persistStateAction,
  reconcileSubIssuesAction,
  applyTriageOutputAction,
  runClaudeGroomingAction,
  runClaudeIterationAction,
  runClaudeTriageAction,
} from "../../src/machines/example/actions.js";
import type {
  ExampleContext,
  IssueStateRepository,
} from "../../src/machines/example/context.js";
import type { TCreateActionForDomain } from "../../src/core/pev/action-registry.js";
import type { ExampleServices } from "../../src/machines/example/services.js";
import {
  mockExampleContext,
  mockExampleIssue,
  mockExampleServices,
} from "./mock-factories.js";

const createAction: TCreateActionForDomain<ExampleContext, ExampleServices> = (
  action,
) => action;

describe("example triage actions", () => {
  it("runClaudeTriage uses configured triage service", async () => {
    const triageIssue = vi.fn(async () => ({
      labelsToAdd: ["triaged", "type:bug"],
      summary: "Classified as bug",
    }));
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ number: 42 }),
      triageOutput: null,
    });
    const services = mockExampleServices({
      triage: { triageIssue },
    });
    const actionDef = runClaudeTriageAction(createAction);

    const result = await actionDef.execute({
      action: {
        type: "runClaudeTriage",
        payload: {
          issueNumber: 42,
          promptVars: {
            ISSUE_NUMBER: "42",
            ISSUE_TITLE: "Title",
            ISSUE_BODY: "Body",
            ISSUE_COMMENTS: "",
          },
        },
      },
      ctx,
      services,
    });

    expect(triageIssue).toHaveBeenCalledOnce();
    expect(ctx.triageOutput).toEqual({
      labelsToAdd: ["triaged", "type:bug"],
      summary: "Classified as bug",
    });
    expect(result).toEqual({
      ok: true,
      output: {
        labelsToAdd: ["triaged", "type:bug"],
        summary: "Classified as bug",
      },
    });
  });

  it("applyTriageOutput consumes triage output and persists when save exists", async () => {
    const save = vi.fn(async () => true);
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ labels: [] }),
      triageOutput: {
        labelsToAdd: ["triaged", "type:enhancement"],
        summary: "Classified as enhancement",
      },
    });
    const repository: IssueStateRepository & { save: () => Promise<boolean> } =
      {
        setIssueStatus: vi.fn(),
        addIssueLabels: vi.fn((labels: string[]) => {
          ctx.issue.labels = [...new Set([...ctx.issue.labels, ...labels])];
        }),
        reconcileSubIssues: vi.fn(),
        save,
      };
    ctx.repository = repository;
    const actionDef = applyTriageOutputAction(createAction);

    const result = await actionDef.execute({
      action: {
        type: "applyTriageOutput",
        payload: { issueNumber: 42 },
      },
      ctx,
      services: mockExampleServices(),
    });

    expect(ctx.issue.labels).toEqual(["triaged", "type:enhancement"]);
    expect(save).toHaveBeenCalledOnce();
    expect(ctx.triageOutput).toBeNull();
    expect(result).toEqual({ ok: true });
  });
});

describe("example grooming actions", () => {
  it("runClaudeGrooming uses configured grooming service", async () => {
    const groomIssue = vi.fn(async () => ({
      labelsToAdd: ["groomed", "needs-spec"],
      suggestedSubIssueNumbers: [421, 422],
      summary: "Break into two implementation phases",
    }));
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ number: 42 }),
      groomingOutput: null,
    });
    const services = mockExampleServices({
      grooming: { groomIssue },
    });
    const actionDef = runClaudeGroomingAction(createAction);

    const result = await actionDef.execute({
      action: {
        type: "runClaudeGrooming",
        payload: {
          issueNumber: 42,
          promptVars: {
            ISSUE_NUMBER: "42",
            ISSUE_TITLE: "Title",
            ISSUE_BODY: "Body",
            ISSUE_COMMENTS: "",
            ISSUE_LABELS: "",
          },
        },
      },
      ctx,
      services,
    });

    expect(groomIssue).toHaveBeenCalledOnce();
    expect(ctx.groomingOutput).toEqual({
      labelsToAdd: ["groomed", "needs-spec"],
      suggestedSubIssueNumbers: [421, 422],
      summary: "Break into two implementation phases",
    });
    expect(result).toEqual({
      ok: true,
      output: {
        labelsToAdd: ["groomed", "needs-spec"],
        suggestedSubIssueNumbers: [421, 422],
        summary: "Break into two implementation phases",
      },
    });
  });

  it("apply/reconcile grooming output updates labels, creates sub-issues, persists, and clears output", async () => {
    const save = vi.fn(async () => true);
    let nextIssueNumber = 1000;
    const createSubIssue = vi.fn(async () => {
      const issueNumber = nextIssueNumber++;
      ctx.issue.subIssues.push({
        number: issueNumber,
        projectStatus: "Backlog",
        state: "OPEN",
      });
      ctx.issue.hasSubIssues = true;
      return { issueNumber };
    });
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({
        labels: [],
        subIssues: [],
        hasSubIssues: false,
      }),
      groomingOutput: {
        labelsToAdd: ["groomed", "needs-spec"],
        decision: "ready",
        summary: "Split work",
        recommendedPhases: [
          { phase_number: 1, title: "Backend", description: "Backend work" },
          { phase_number: 2, title: "Frontend", description: "Frontend work" },
        ],
      },
    });
    const repository: IssueStateRepository & { save: () => Promise<boolean> } =
      {
        setIssueStatus: vi.fn(),
        addIssueLabels: vi.fn((labels: string[]) => {
          ctx.issue.labels = [...new Set([...ctx.issue.labels, ...labels])];
        }),
        reconcileSubIssues: vi.fn((subIssueNumbers: number[]) => {
          ctx.issue.subIssues = subIssueNumbers.map((number) => ({
            number,
            projectStatus: "Backlog",
            state: "OPEN",
          }));
          ctx.issue.hasSubIssues = subIssueNumbers.length > 0;
        }),
        createSubIssue,
        save,
      };
    ctx.repository = repository;
    const applyDef = applyGroomingOutputAction(createAction);
    const reconcileDef = reconcileSubIssuesAction(createAction);

    const applyResult = await applyDef.execute({
      action: {
        type: "applyGroomingOutput",
        payload: { issueNumber: 42 },
      },
      ctx,
      services: mockExampleServices(),
    });
    const reconcileResult = await reconcileDef.execute({
      action: {
        type: "reconcileSubIssues",
        payload: { issueNumber: 42 },
      },
      ctx,
      services: mockExampleServices(),
    });

    expect(applyResult).toEqual({ ok: true, decision: "ready" });
    expect(reconcileResult).toEqual({ ok: true, decision: "ready" });
    expect(ctx.issue.labels).toEqual(["groomed", "needs-spec"]);
    expect(createSubIssue).toHaveBeenCalledTimes(2);
    expect(ctx.issue.hasSubIssues).toBe(true);
    expect(ctx.issue.subIssues).toHaveLength(2);
    expect(save).toHaveBeenCalledOnce();
    expect(ctx.groomingOutput).toBeNull();
  });

  it("reconcileSubIssues verification fails when no recommended phases returned", async () => {
    const save = vi.fn(async () => true);
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({
        labels: [],
        subIssues: [],
        hasSubIssues: false,
      }),
      groomingOutput: {
        labelsToAdd: ["groomed"],
        decision: "ready",
        summary: "Ready but no phases",
      },
    });
    const repository: IssueStateRepository & { save: () => Promise<boolean> } =
      {
        setIssueStatus: vi.fn(),
        addIssueLabels: vi.fn(),
        reconcileSubIssues: vi.fn(),
        save,
      };
    ctx.repository = repository;
    const reconcileDef = reconcileSubIssuesAction(createAction);

    const reconcileResult = await reconcileDef.execute({
      action: {
        type: "reconcileSubIssues",
        payload: { issueNumber: 42 },
      },
      ctx,
      services: mockExampleServices(),
    });

    // Execute succeeds but hasSubIssues is still false
    expect(reconcileResult).toEqual({ ok: true, decision: "ready" });
    expect(ctx.issue.hasSubIssues).toBe(false);

    // Verify should fail since prediction expects hasSubIssues=true
    const prediction = reconcileDef.predict?.(
      { type: "reconcileSubIssues", payload: { issueNumber: 42 } },
      ctx,
    );
    expect(prediction?.checks).toHaveLength(1);

    // Custom verify should catch the mismatch
    const verifyResult = reconcileDef.verify?.({
      action: { type: "reconcileSubIssues", payload: { issueNumber: 42 } },
      oldCtx: ctx,
      newCtx: ctx,
      prediction: prediction ?? null,
      predictionEval: { pass: false, diffs: [] },
      predictionDiffs: [],
      executeResult: reconcileResult,
    });
    expect(verifyResult).toEqual({
      message:
        "Grooming decision was 'ready' but issue has no sub-issues after reconciliation",
    });
  });
});

describe("example iteration actions", () => {
  it("runClaudeIteration uses configured iteration service", async () => {
    const iterateIssue = vi.fn(async () => ({
      labelsToAdd: ["iteration:ready", "ci:fixing"],
      summary: "Address CI and rerun checks",
    }));
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ number: 42 }),
      iterationOutput: null,
    });
    const services = mockExampleServices({
      iteration: { iterateIssue },
    });
    const actionDef = runClaudeIterationAction(createAction);

    const result = await actionDef.execute({
      action: {
        type: "runClaudeIteration",
        payload: {
          issueNumber: 42,
          mode: "iterate",
          promptVars: {
            ISSUE_NUMBER: "42",
            ISSUE_TITLE: "Title",
            ISSUE_BODY: "Body",
            ISSUE_COMMENTS: "",
            ISSUE_LABELS: "",
            CI_RESULT: "failure",
            REVIEW_DECISION: "none",
            ITERATION: "0",
            LAST_CI_RESULT: "none",
            CONSECUTIVE_FAILURES: "0",
            BRANCH_NAME: "main",
            PR_CREATE_COMMAND: "",
            AGENT_NOTES: "",
          },
        },
      },
      ctx,
      services,
    });

    expect(iterateIssue).toHaveBeenCalledOnce();
    expect(ctx.iterationOutput).toEqual({
      labelsToAdd: ["iteration:ready", "ci:fixing"],
      summary: "Address CI and rerun checks",
    });
    expect(result).toEqual({
      ok: true,
      output: {
        labelsToAdd: ["iteration:ready", "ci:fixing"],
        summary: "Address CI and rerun checks",
      },
    });
  });

  it("applyIterationOutput consumes output, persists labels, and clears output", async () => {
    const save = vi.fn(async () => true);
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ labels: [] }),
      iterationOutput: {
        labelsToAdd: ["iteration:ready"],
        summary: "summary",
      },
    });
    const repository: IssueStateRepository & { save: () => Promise<boolean> } =
      {
        setIssueStatus: vi.fn(),
        addIssueLabels: vi.fn((labels: string[]) => {
          ctx.issue.labels = [...new Set([...ctx.issue.labels, ...labels])];
        }),
        reconcileSubIssues: vi.fn(),
        save,
      };
    ctx.repository = repository;
    const actionDef = applyIterationOutputAction(createAction);

    const result = await actionDef.execute({
      action: {
        type: "applyIterationOutput",
        payload: { issueNumber: 42 },
      },
      ctx,
      services: mockExampleServices(),
    });

    expect(result).toEqual({ ok: true });
    expect(ctx.issue.labels).toEqual(["iteration:ready"]);
    expect(save).toHaveBeenCalledOnce();
    expect(ctx.iterationOutput).toBeNull();
  });
});

describe("state persistence action", () => {
  it("persistState invokes repository save and succeeds", async () => {
    const save = vi.fn(async () => true);
    const ctx: ExampleContext = mockExampleContext();
    const repository: IssueStateRepository & { save: () => Promise<boolean> } =
      {
        setIssueStatus: vi.fn(),
        addIssueLabels: vi.fn(),
        reconcileSubIssues: vi.fn(),
        save,
      };
    ctx.repository = repository;
    const actionDef = persistStateAction(createAction);

    const result = await actionDef.execute({
      action: {
        type: "persistState",
        payload: { issueNumber: 42, reason: "test" },
      },
      ctx,
      services: mockExampleServices(),
    });

    expect(result).toEqual({ ok: true });
    expect(save).toHaveBeenCalledOnce();
  });
});
