import { describe, test, expect } from "vitest";
import { createActor } from "xstate";
import { claudeMachine, getTriggerEvent } from "../../machine/machine.js";
import type { MachineContext } from "../../schemas/index.js";
import { createContext } from "../fixtures/index.js";

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
      });
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
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("blocked");
      // When already blocked, no actions are emitted (to avoid redundant updates)
      // The blockIssue action emits setBlocked+unassign only when transitioning TO blocked
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("log"); // Only the detecting log
      expect(actionTypes).not.toContain("updateProjectStatus");
      expect(actionTypes).not.toContain("unassignUser");
    });

    test("transitions to error when status is Error", () => {
      const context = createContext({
        issue: { projectStatus: "Error" },
      });
      const { state } = runMachine(context);
      expect(state).toBe("error");
    });

    test("transitions to iterating for normal issue", () => {
      const context = createContext({
        issue: { projectStatus: "In progress" },
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("iterating");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("incrementIteration");
      expect(actionTypes).toContain("runClaude");
    });

    test("transitions to reviewing when status is Review", () => {
      const context = createContext({
        issue: { projectStatus: "In review" },
      });
      const { state } = runMachine(context);
      expect(state).toBe("reviewing");
    });
  });

  describe("CI triggered transitions", () => {
    test("processes CI success and transitions to review when todos done", () => {
      const context = createContext({
        trigger: "workflow_run_completed",
        ciResult: "success",
        issue: { projectStatus: "In progress" },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
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
      });
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
        issue: { projectStatus: "In progress", failures: 2 },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("iterating");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("clearFailures");
    });

    test("processes CI failure and records failure", () => {
      const context = createContext({
        trigger: "workflow_run_completed",
        ciResult: "failure",
        issue: { projectStatus: "In progress", failures: 2 },
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      });
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
        issue: { projectStatus: "In progress", failures: 5 },
        maxRetries: 5,
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      });
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
        issue: {
          projectStatus: "In review",
          hasSubIssues: true,
          subIssues: [],
        },
      });
      const { state } = runMachine(context);
      // After orchestrating with empty sub-issues, goes to orchestrationComplete
      expect([
        "orchestrating",
        "orchestrationComplete",
        "orchestrationRunning",
      ]).toContain(state);
    });

    test("processes review changes requested and iterates", () => {
      const context = createContext({
        trigger: "pr_review_submitted",
        reviewDecision: "CHANGES_REQUESTED",
        issue: { projectStatus: "In review" },
        pr: {
          number: 42,
          state: "OPEN",
          isDraft: false,
          title: "Test PR",
          headRef: "feature",
          baseRef: "main",
        },
      });
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
        issue: { projectStatus: "In review" },
      });
      const { state } = runMachine(context);
      expect(state).toBe("reviewing");
    });
  });

  describe("Triage triggered transitions", () => {
    test("transitions to triaging when triggered by issue_triage", () => {
      const context = createContext({
        trigger: "issue_triage",
        issue: {
          number: 123,
          title: "New feature request",
          body: "## Description\n\nImplement X feature",
          projectStatus: null,
        },
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("triaging");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("log");
      expect(actionTypes).toContain("runClaude");
    });

    test("emits runClaude with promptFile for triage", () => {
      const context = createContext({
        trigger: "issue_triage",
        issue: {
          number: 456,
          title: "Bug report",
          body: "## Description\n\nSomething is broken",
          projectStatus: null,
        },
        owner: "test-owner",
        repo: "test-repo",
      });
      const { actions } = runMachine(context);
      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptFile).toBe(".github/prompts/triage.txt");
        expect(runClaudeAction.promptVars).toEqual({
          ISSUE_NUMBER: "456",
          ISSUE_TITLE: "Bug report",
          ISSUE_BODY: "## Description\n\nSomething is broken",
          REPO_OWNER: "test-owner",
          REPO_NAME: "test-repo",
        });
        expect(runClaudeAction.issueNumber).toBe(456);
      } else {
        expect.fail("runClaude action not found");
      }
    });

    test("does not triage when already done", () => {
      const context = createContext({
        trigger: "issue_triage",
        issue: { projectStatus: "Done" },
      });
      const { state } = runMachine(context);
      // Done takes precedence over triage
      expect(state).toBe("done");
    });

    test("does not triage when blocked", () => {
      const context = createContext({
        trigger: "issue_triage",
        issue: { projectStatus: "Blocked" },
      });
      const { state } = runMachine(context);
      // Blocked takes precedence over triage
      expect(state).toBe("blocked");
    });
  });

  describe("Comment triggered transitions", () => {
    test("transitions to commenting when triggered by issue_comment", () => {
      const context = createContext({
        trigger: "issue_comment",
        issue: {
          number: 123,
          title: "Feature request",
          body: "## Description\n\nImplement feature",
          projectStatus: "In progress",
        },
        commentContextType: "Issue",
        commentContextDescription:
          "This is issue #123 about implementing feature X.",
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("commenting");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("log");
      expect(actionTypes).toContain("runClaude");
    });

    test("emits runClaude with promptFile for comment", () => {
      const context = createContext({
        trigger: "issue_comment",
        issue: {
          number: 456,
          title: "Bug fix PR",
          body: "Fixes a bug",
          projectStatus: "In review",
        },
        branch: "claude/issue/456",
        commentContextType: "PR",
        commentContextDescription:
          "This is PR #789 fixing bug in authentication.",
      });
      const { actions } = runMachine(context);
      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptFile).toBe(".github/prompts/comment.txt");
        expect(runClaudeAction.promptVars).toEqual({
          ISSUE_NUMBER: "456",
          CONTEXT_TYPE: "PR",
          CONTEXT_DESCRIPTION: "This is PR #789 fixing bug in authentication.",
        });
        expect(runClaudeAction.issueNumber).toBe(456);
        // worktree is intentionally not set - checkout happens at repo root to the correct branch
        expect(runClaudeAction.worktree).toBeUndefined();
      } else {
        expect.fail("runClaude action not found");
      }
    });

    test("uses default context values when not provided", () => {
      const context = createContext({
        trigger: "issue_comment",
        issue: {
          number: 789,
          projectStatus: "In progress",
        },
        commentContextType: null,
        commentContextDescription: null,
      });
      const { actions } = runMachine(context);
      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptVars).toEqual({
          ISSUE_NUMBER: "789",
          CONTEXT_TYPE: "Issue",
          CONTEXT_DESCRIPTION: "This is issue #789.",
        });
      } else {
        expect.fail("runClaude action not found");
      }
    });

    test("does not comment when already done", () => {
      const context = createContext({
        trigger: "issue_comment",
        issue: { projectStatus: "Done" },
        commentContextType: "Issue",
        commentContextDescription: "Test",
      });
      const { state } = runMachine(context);
      // Done takes precedence over comment
      expect(state).toBe("done");
    });

    test("does not comment when blocked", () => {
      const context = createContext({
        trigger: "issue_comment",
        issue: { projectStatus: "Blocked" },
        commentContextType: "Issue",
        commentContextDescription: "Test",
      });
      const { state } = runMachine(context);
      // Blocked takes precedence over comment
      expect(state).toBe("blocked");
    });
  });

  describe("Multi-phase orchestration", () => {
    test("transitions to orchestrationComplete when all phases are done", () => {
      const context = createContext({
        issue: {
          projectStatus: "In progress",
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
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("orchestrationComplete");
      // Should emit completion actions
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("closeIssue");
    });

    test("transitions to orchestrationRunning when current phase needs work", () => {
      const context = createContext({
        issue: {
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "In progress",
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
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
        },
        currentPhase: 1,
        totalPhases: 2,
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("orchestrationRunning");
      // Should emit orchestration actions including assignUser
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("assignUser");
      expect(actionTypes).toContain("stop");
    });

    test("transitions to orchestrationWaiting when current phase is in review", () => {
      const context = createContext({
        issue: {
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "In review",
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
          projectStatus: "In review",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
        },
      });
      const { state, actions } = runMachine(context);
      expect(state).toBe("orchestrationWaiting");
      // Should emit stop action with waiting reason
      const stopAction = actions.find((a) => a.type === "stop");
      if (stopAction?.type === "stop") {
        expect(stopAction.reason).toContain("review");
      } else {
        expect.fail("stop action not found");
      }
    });
  });

  describe("Action accumulation", () => {
    test("accumulates multiple actions during transitions", () => {
      const context = createContext({
        issue: { projectStatus: "In progress" },
      });
      const { actions } = runMachine(context);
      // Should have log, setWorking, incrementIteration, and runClaude actions
      expect(actions.length).toBeGreaterThan(2);
    });

    test("includes issue number in actions", () => {
      const context = createContext({
        issue: { number: 123, projectStatus: "In progress" },
      });
      const { actions } = runMachine(context);
      const updateAction = actions.find(
        (a) => a.type === "updateProjectStatus",
      );
      if (updateAction?.type === "updateProjectStatus") {
        expect(updateAction.issueNumber).toBe(123);
      } else {
        expect.fail("updateProjectStatus action not found");
      }
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

  test("returns START for issue_triage", () => {
    const context = createContext({ trigger: "issue_triage" });
    expect(getTriggerEvent(context)).toEqual({ type: "START" });
  });

  test("returns START for workflow_run without result", () => {
    const context = createContext({
      trigger: "workflow_run_completed",
      ciResult: null,
    });
    expect(getTriggerEvent(context)).toEqual({ type: "START" });
  });

  test("returns START for issue_comment", () => {
    const context = createContext({ trigger: "issue_comment" });
    expect(getTriggerEvent(context)).toEqual({ type: "START" });
  });
});
