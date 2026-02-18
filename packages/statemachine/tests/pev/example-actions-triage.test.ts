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
import { mockExampleContext, mockExampleIssue } from "./mock-factories.js";

const createAction: TCreateActionForDomain<ExampleContext> = (action) => action;

describe("example triage actions", () => {
  it("runClaudeTriage uses configured triage service", async () => {
    const triageIssue = vi.fn(async () => ({
      labelsToAdd: ["triaged", "type:bug"],
      summary: "Classified as bug",
    }));
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ number: 42 }),
      triageOutput: null,
      services: {
        triage: { triageIssue },
      },
    });
    const actionDef = runClaudeTriageAction(createAction);

    const result = await actionDef.execute(
      {
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
    );

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

  it("runClaudeTriage throws when triage service is missing", async () => {
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ number: 42 }),
      services: undefined,
    });
    const actionDef = runClaudeTriageAction(createAction);

    await expect(
      actionDef.execute(
        {
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
      ),
    ).rejects.toThrow("No triage service configured");
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

    const result = await actionDef.execute(
      {
        type: "applyTriageOutput",
        payload: { issueNumber: 42 },
      },
      ctx,
    );

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
      services: {
        grooming: { groomIssue },
      },
    });
    const actionDef = runClaudeGroomingAction(createAction);

    const result = await actionDef.execute(
      {
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
    );

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

  it("runClaudeGrooming throws when grooming service is missing", async () => {
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({ number: 42 }),
      services: undefined,
    });
    const actionDef = runClaudeGroomingAction(createAction);

    await expect(
      actionDef.execute(
        {
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
      ),
    ).rejects.toThrow("No grooming service configured");
  });

  it("apply/reconcile grooming output updates labels, sub-issues, persists, and clears output", async () => {
    const save = vi.fn(async () => true);
    const ctx: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({
        labels: [],
        subIssues: [],
        hasSubIssues: false,
      }),
      groomingOutput: {
        labelsToAdd: ["groomed", "needs-spec"],
        suggestedSubIssueNumbers: [101, 102],
        summary: "Split work",
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
        save,
      };
    ctx.repository = repository;
    const applyDef = applyGroomingOutputAction(createAction);
    const reconcileDef = reconcileSubIssuesAction(createAction);

    const applyResult = await applyDef.execute(
      {
        type: "applyGroomingOutput",
        payload: { issueNumber: 42 },
      },
      ctx,
    );
    const reconcileResult = await reconcileDef.execute(
      {
        type: "reconcileSubIssues",
        payload: { issueNumber: 42 },
      },
      ctx,
    );

    expect(applyResult).toEqual({ ok: true });
    expect(reconcileResult).toEqual({ ok: true });
    expect(ctx.issue.labels).toEqual(["groomed", "needs-spec"]);
    expect(ctx.issue.subIssues.map((subIssue) => subIssue.number)).toEqual([
      101, 102,
    ]);
    expect(save).toHaveBeenCalledOnce();
    expect(ctx.groomingOutput).toBeNull();
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
      services: {
        iteration: { iterateIssue },
      },
    });
    const actionDef = runClaudeIterationAction(createAction);

    const result = await actionDef.execute(
      {
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
          },
        },
      },
      ctx,
    );

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

    const result = await actionDef.execute(
      {
        type: "applyIterationOutput",
        payload: { issueNumber: 42 },
      },
      ctx,
    );

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

    const result = await actionDef.execute(
      {
        type: "persistState",
        payload: { issueNumber: 42, reason: "test" },
      },
      ctx,
    );

    expect(result).toEqual({ ok: true });
    expect(save).toHaveBeenCalledOnce();
  });
});
