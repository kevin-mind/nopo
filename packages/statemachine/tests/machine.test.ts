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
