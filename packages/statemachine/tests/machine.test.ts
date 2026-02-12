import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import { parseMarkdown } from "@more/issue-state";
import {
  createMachineContext,
  claudeMachine,
  emitSetWorking,
  emitLog,
} from "../src/index.js";
import { emit, accumulateFromEmitter } from "../src/machine/emit-helper.js";
import type { MachineContext, Action } from "../src/schemas/index.js";
import { ParentIssueSchema } from "../src/schemas/index.js";

// ============================================================================
// Test Fixtures
// ============================================================================

function createTriageContext(
  overrides: Partial<MachineContext> = {},
): MachineContext {
  const issue = ParentIssueSchema.parse({
    number: 42,
    title: "Test Issue",
    state: "OPEN",
    bodyAst: parseMarkdown("# Task\n\n- [ ] item 1"),
    projectStatus: "Backlog",
    iteration: 0,
    failures: 0,
    assignees: [],
    labels: [],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: null,
  });

  return createMachineContext({
    trigger: "issue-triage",
    owner: "test-owner",
    repo: "test-repo",
    issue,
    ...overrides,
  });
}

// ============================================================================
// emit helper tests
// ============================================================================

describe("emit helper", () => {
  it("accumulateFromEmitter appends emitter output to existing actions", () => {
    const context = createTriageContext();
    const existing: Action[] = [
      {
        type: "log",
        token: "code",
        level: "info",
        message: "first",
        worktree: "main",
      },
    ];

    const result = accumulateFromEmitter(existing, context, emitSetWorking);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "log", message: "first" });
    expect(result[1]).toMatchObject({
      type: "updateProjectStatus",
      status: "In progress",
      issueNumber: 42,
    });
  });

  it("emit returns assign action (callable with emitter)", () => {
    const actionConfig = emit(emitSetWorking);
    expect(actionConfig).toBeDefined();
    expect(
      typeof actionConfig === "function" || typeof actionConfig === "object",
    ).toBe(true);
  });

  it("emit supports arrow emitters (e.g. emitLog with message)", () => {
    const actionConfig = emit((ctx) => emitLog(ctx, "Test message"));
    expect(actionConfig).toBeDefined();
  });
});

// ============================================================================
// Sub-issue context helper
// ============================================================================

function createSubIssueContext(
  overrides: Partial<MachineContext> = {},
): MachineContext {
  const issue = ParentIssueSchema.parse({
    number: 100,
    title: "[Phase 1]: Implementation",
    state: "OPEN",
    bodyAst: parseMarkdown("# Task\n\n- [ ] implement feature"),
    projectStatus: null,
    iteration: 0,
    failures: 0,
    assignees: [],
    labels: ["triaged", "groomed"],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: 99,
  });

  const parentIssue = ParentIssueSchema.parse({
    number: 99,
    title: "Parent Issue",
    state: "OPEN",
    bodyAst: parseMarkdown("# Parent"),
    projectStatus: "In progress",
    iteration: 0,
    failures: 0,
    assignees: ["nopo-bot"],
    labels: ["triaged", "groomed"],
    subIssues: [],
    hasSubIssues: true,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: null,
  });

  return createMachineContext({
    trigger: "issue-edited",
    owner: "test-owner",
    repo: "test-repo",
    issue,
    parentIssue,
    ...overrides,
  });
}

// ============================================================================
// Machine integration tests (verify emit refactor preserves behavior)
// ============================================================================

describe("claudeMachine with emit helper", () => {
  it("emits expected actions for triaging transition", () => {
    const context = createTriageContext();
    const actor = createActor(claudeMachine, {
      input: context,
    });

    actor.start();
    actor.send({ type: "DETECT" });

    const snapshot = actor.getSnapshot();
    expect(snapshot.status).toBe("done");

    const actions = snapshot.context.pendingActions;
    expect(actions.length).toBeGreaterThan(0);

    const actionTypes = actions.map((a) => a.type);
    expect(actionTypes).toContain("log");
    expect(actionTypes).toContain("runClaude");
  });
});

// ============================================================================
// Sub-issue routing tests
// ============================================================================

describe("sub-issue routing", () => {
  it("iterates when sub-issue has bot assigned", () => {
    const issue = ParentIssueSchema.parse({
      number: 100,
      title: "[Phase 1]: Implementation",
      state: "OPEN",
      bodyAst: parseMarkdown("# Task\n\n- [ ] implement feature"),
      projectStatus: null,
      iteration: 0,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      subIssues: [],
      hasSubIssues: false,
      comments: [],
      branch: null,
      pr: null,
      parentIssueNumber: 99,
    });

    const context = createSubIssueContext({ issue });
    const actor = createActor(claudeMachine, { input: context });

    actor.start();
    actor.send({ type: "DETECT" });

    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("iterating");

    const actionTypes = snapshot.context.pendingActions.map((a) => a.type);
    expect(actionTypes).toContain("runClaude");
  });

  it("goes to subIssueIdle when sub-issue has NO bot assigned", () => {
    const context = createSubIssueContext();
    const actor = createActor(claudeMachine, { input: context });

    actor.start();
    actor.send({ type: "DETECT" });

    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("subIssueIdle");

    const logActions = snapshot.context.pendingActions.filter(
      (a) => a.type === "log",
    );
    const hasSkipMessage = logActions.some(
      (a) =>
        "message" in a &&
        typeof a.message === "string" &&
        a.message.includes("not assigned"),
    );
    expect(hasSkipMessage).toBe(true);

    // Should NOT have runClaude or iteration actions
    const actionTypes = snapshot.context.pendingActions.map((a) => a.type);
    expect(actionTypes).not.toContain("runClaude");
    expect(actionTypes).not.toContain("incrementIteration");
  });
});
