import { describe, test, expect } from "vitest";
import { createActor } from "xstate";
import { claudeMachine, getTriggerEvent } from "../../machine/machine.js";
import type { MachineContext } from "../../schemas/index.js";

// Helper to create minimal context
function createContext(
  overrides: Partial<MachineContext> = {},
): MachineContext {
  const base: MachineContext = {
    trigger: "issue_assigned",
    owner: "test-owner",
    repo: "test-repo",
    issue: {
      number: 1,
      title: "Test Issue",
      state: "OPEN",
      body: "Test body",
      projectStatus: "In Progress",
      iteration: 0,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
    parentIssue: null,
    currentPhase: null,
    totalPhases: 0,
    currentSubIssue: null,
    ciResult: null,
    ciRunUrl: null,
    ciCommitSha: null,
    reviewDecision: null,
    reviewerId: null,
    branch: null,
    hasBranch: false,
    pr: null,
    hasPR: false,
    maxRetries: 5,
    botUsername: "nopo-bot",
  };

  return {
    ...base,
    ...overrides,
    issue: { ...base.issue, ...(overrides.issue as any) },
  };
}

// Helper to run the machine and get final state
function runMachine(context: MachineContext) {
  const actor = createActor(claudeMachine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();
  actor.stop();
  return {
    state: String(snapshot.value),
    actions: snapshot.context.pendingActions,
  };
}

describe("claudeMachine", () => {
  describe("Initial state detection", () => {
    test("transitions to done when status is Done", () => {
      const context = createContext({
        issue: { projectStatus: "Done" },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("done");
      // Should have setDone and closeIssue actions
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("closeIssue");
    });

    test("transitions to blocked when status is Blocked", () => {
      const context = createContext({
        issue: { projectStatus: "Blocked" },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("blocked");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("unassignUser");
    });

    test("transitions to error when status is Error", () => {
      const context = createContext({
        issue: { projectStatus: "Error" },
      } as any);
      const { state } = runMachine(context);
      expect(state).toBe("error");
    });

    test("transitions to iterating for normal issue", () => {
      const context = createContext({
        issue: { projectStatus: "Working" },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("iterating");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("incrementIteration");
      expect(actionTypes).toContain("runClaude");
    });

    test("transitions to reviewing when status is Review", () => {
      const context = createContext({
        issue: { projectStatus: "Review" },
      } as any);
      const { state } = runMachine(context);
      expect(state).toBe("reviewing");
    });
  });

  describe("CI triggered transitions", () => {
    test("processes CI success and transitions to review when todos done", () => {
      const context = createContext({
        trigger: "workflow_run_completed",
        ciResult: "success",
        issue: { projectStatus: "Working" },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Working",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 3, uncheckedNonManual: 0 },
        },
        hasPR: true,
        pr: {
          number: 42,
          state: "OPEN",
          isDraft: true,
          title: "Test PR",
          headRef: "feature",
          baseRef: "main",
        },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("reviewing");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("markPRReady");
      expect(actionTypes).toContain("requestReview");
    });

    test("processes CI success but continues iterating when todos not done", () => {
      const context = createContext({
        trigger: "workflow_run_completed",
        ciResult: "success",
        issue: { projectStatus: "Working", failures: 2 },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Working",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("iterating");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("clearFailures");
    });

    test("processes CI failure and records failure", () => {
      const context = createContext({
        trigger: "workflow_run_completed",
        ciResult: "failure",
        issue: { projectStatus: "Working", failures: 2 },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Working",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("iteratingFix");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("recordFailure");
      expect(actionTypes).toContain("runClaude");
    });

    test("processes CI failure and blocks when max failures reached", () => {
      const context = createContext({
        trigger: "workflow_run_completed",
        ciResult: "failure",
        issue: { projectStatus: "Working", failures: 5 },
        maxRetries: 5,
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Working",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("blocked");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("block");
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("unassignUser");
    });
  });

  describe("Review triggered transitions", () => {
    test("processes review approval and moves to orchestrating", () => {
      const context = createContext({
        trigger: "pr_review_submitted",
        reviewDecision: "APPROVED",
        issue: { projectStatus: "Review", hasSubIssues: true, subIssues: [] },
      } as any);
      const { state } = runMachine(context);
      // After orchestrating, should reach done since all sub-issues are empty (edge case)
      expect(["orchestrating", "done", "iterating"]).toContain(state);
    });

    test("processes review changes requested and iterates", () => {
      const context = createContext({
        trigger: "pr_review_submitted",
        reviewDecision: "CHANGES_REQUESTED",
        issue: { projectStatus: "Review" },
        pr: {
          number: 42,
          state: "OPEN",
          isDraft: false,
          title: "Test PR",
          headRef: "feature",
          baseRef: "main",
        },
      } as any);
      const { state, actions } = runMachine(context);
      expect(state).toBe("iterating");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("convertPRToDraft");
      expect(actionTypes).toContain("updateProjectStatus");
    });

    test("processes review comment and stays in reviewing", () => {
      const context = createContext({
        trigger: "pr_review_submitted",
        reviewDecision: "COMMENTED",
        issue: { projectStatus: "Review" },
      } as any);
      const { state } = runMachine(context);
      expect(state).toBe("reviewing");
    });
  });

  describe("Multi-phase orchestration", () => {
    test("transitions to done when all phases are done", () => {
      const context = createContext({
        issue: {
          projectStatus: "In Progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "CLOSED",
              body: "",
              projectStatus: "Done",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
            {
              number: 2,
              title: "Phase 2",
              state: "CLOSED",
              body: "",
              projectStatus: "Done",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
          ],
        },
      } as any);
      const { state } = runMachine(context);
      expect(state).toBe("done");
    });

    test("transitions to iterating when current phase needs work", () => {
      const context = createContext({
        issue: {
          projectStatus: "In Progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "Working",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
            },
            {
              number: 2,
              title: "Phase 2",
              state: "OPEN",
              body: "",
              projectStatus: "Ready",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
            },
          ],
        },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Working",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
        },
      } as any);
      const { state } = runMachine(context);
      expect(state).toBe("iterating");
    });

    test("transitions to reviewing when current phase is in review", () => {
      const context = createContext({
        issue: {
          projectStatus: "In Progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "Review",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
            {
              number: 2,
              title: "Phase 2",
              state: "OPEN",
              body: "",
              projectStatus: "Ready",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
            },
          ],
        },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Review",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
        },
      } as any);
      const { state } = runMachine(context);
      expect(state).toBe("reviewing");
    });
  });

  describe("Action accumulation", () => {
    test("accumulates multiple actions during transitions", () => {
      const context = createContext({
        issue: { projectStatus: "Working" },
      } as any);
      const { actions } = runMachine(context);
      // Should have log, setWorking, incrementIteration, and runClaude actions
      expect(actions.length).toBeGreaterThan(2);
    });

    test("includes issue number in actions", () => {
      const context = createContext({
        issue: { number: 123, projectStatus: "Working" },
      } as any);
      const { actions } = runMachine(context);
      const updateAction = actions.find(
        (a) => a.type === "updateProjectStatus",
      );
      expect(updateAction).toBeDefined();
      expect((updateAction as any).issueNumber).toBe(123);
    });
  });
});

describe("getTriggerEvent", () => {
  test("returns CI_SUCCESS for successful workflow_run", () => {
    const context = createContext({
      trigger: "workflow_run_completed",
      ciResult: "success",
    });
    expect(getTriggerEvent(context)).toEqual({ type: "CI_SUCCESS" });
  });

  test("returns CI_FAILURE for failed workflow_run", () => {
    const context = createContext({
      trigger: "workflow_run_completed",
      ciResult: "failure",
    });
    expect(getTriggerEvent(context)).toEqual({ type: "CI_FAILURE" });
  });

  test("returns REVIEW_APPROVED for approved review", () => {
    const context = createContext({
      trigger: "pr_review_submitted",
      reviewDecision: "APPROVED",
    });
    expect(getTriggerEvent(context)).toEqual({ type: "REVIEW_APPROVED" });
  });

  test("returns REVIEW_CHANGES_REQUESTED for changes requested", () => {
    const context = createContext({
      trigger: "pr_review_submitted",
      reviewDecision: "CHANGES_REQUESTED",
    });
    expect(getTriggerEvent(context)).toEqual({
      type: "REVIEW_CHANGES_REQUESTED",
    });
  });

  test("returns REVIEW_COMMENTED for comment review", () => {
    const context = createContext({
      trigger: "pr_review_submitted",
      reviewDecision: "COMMENTED",
    });
    expect(getTriggerEvent(context)).toEqual({ type: "REVIEW_COMMENTED" });
  });

  test("returns START for issue_assigned", () => {
    const context = createContext({ trigger: "issue_assigned" });
    expect(getTriggerEvent(context)).toEqual({ type: "START" });
  });

  test("returns START for issue_edited", () => {
    const context = createContext({ trigger: "issue_edited" });
    expect(getTriggerEvent(context)).toEqual({ type: "START" });
  });

  test("returns START for workflow_run without result", () => {
    const context = createContext({
      trigger: "workflow_run_completed",
      ciResult: null,
    });
    expect(getTriggerEvent(context)).toEqual({ type: "START" });
  });
});
