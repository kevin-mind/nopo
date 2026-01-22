import { describe, test, expect } from "vitest";
import {
  emitInitializeParent,
  emitAdvancePhase,
  emitOrchestrate,
  emitAllPhasesDone,
  emitAssignToSubIssue,
} from "../../machine/actions.js";
import type { MachineContext } from "../../schemas/index.js";
import { createContext } from "../fixtures/index.js";

describe("Orchestration action emitters", () => {
  describe("emitInitializeParent", () => {
    test("sets parent to In progress and first sub-issue to In progress", () => {
      const context = createContext({
        issue: {
          number: 100,
          projectStatus: null,
          hasSubIssues: true,
          subIssues: [
            {
              number: 101,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "Ready",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
            },
            {
              number: 102,
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
      } as any);

      const actions = emitInitializeParent({ context });

      expect(actions).toHaveLength(3);

      // First action: set parent to In progress
      expect(actions[0]).toEqual({
        type: "updateProjectStatus",
        issueNumber: 100,
        status: "In progress",
      });

      // Second action: set first sub-issue to In progress
      expect(actions[1]).toEqual({
        type: "updateProjectStatus",
        issueNumber: 101,
        status: "In progress",
      });

      // Third action: append history
      expect(actions[2]).toMatchObject({
        type: "appendHistory",
        issueNumber: 100,
        phase: "1",
        message: expect.stringContaining("2 phase"),
      });
    });
  });

  describe("emitAdvancePhase", () => {
    test("marks current phase Done and sets next to In progress", () => {
      const context = createContext({
        issue: {
          number: 100,
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 101,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "In progress",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
            {
              number: 102,
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
          number: 101,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
        },
        currentPhase: 1,
        totalPhases: 2,
      } as any);

      const actions = emitAdvancePhase({ context });

      expect(actions).toHaveLength(4);

      // Mark current Done
      expect(actions[0]).toEqual({
        type: "updateProjectStatus",
        issueNumber: 101,
        status: "Done",
      });

      // Close current
      expect(actions[1]).toEqual({
        type: "closeIssue",
        issueNumber: 101,
        reason: "completed",
      });

      // Set next to In progress
      expect(actions[2]).toEqual({
        type: "updateProjectStatus",
        issueNumber: 102,
        status: "In progress",
      });

      // Append history
      expect(actions[3]).toMatchObject({
        type: "appendHistory",
        issueNumber: 100,
        phase: "2",
        message: expect.stringContaining("Phase 2"),
      });
    });

    test("returns empty when no current sub-issue", () => {
      const context = createContext({
        issue: {
          number: 100,
          hasSubIssues: true,
          subIssues: [],
        },
        currentSubIssue: null,
        currentPhase: null,
      } as any);

      const actions = emitAdvancePhase({ context });

      expect(actions).toHaveLength(0);
    });
  });

  describe("emitOrchestrate", () => {
    test("initializes and assigns when parent needs init", () => {
      const context = createContext({
        issue: {
          number: 100,
          projectStatus: null,
          hasSubIssues: true,
          subIssues: [
            {
              number: 101,
              title: "Phase 1",
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
          number: 101,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Ready",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
        },
        currentPhase: 1,
        totalPhases: 1,
        botUsername: "nopo-bot",
      } as any);

      const actions = emitOrchestrate({ context });

      const actionTypes = actions.map((a) => a.type);

      // Should log, initialize parent, assign sub-issue, and stop
      expect(actionTypes).toContain("log");
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("appendHistory");
      expect(actionTypes).toContain("assignUser");
      expect(actionTypes).toContain("stop");

      // Check assignUser action
      const assignAction = actions.find((a) => a.type === "assignUser") as any;
      expect(assignAction.issueNumber).toBe(101);
      expect(assignAction.username).toBe("nopo-bot");
    });

    test("advances phase when current phase is complete", () => {
      const context = createContext({
        issue: {
          number: 100,
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 101,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "In progress",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
            {
              number: 102,
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
          number: 101,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
        },
        currentPhase: 1,
        totalPhases: 2,
        botUsername: "nopo-bot",
      } as any);

      const actions = emitOrchestrate({ context });

      // Should advance phase (mark 101 Done, set 102 In progress)
      // and assign to the new sub-issue (102)
      const updateActions = actions.filter(
        (a) => a.type === "updateProjectStatus",
      ) as any[];
      const doneAction = updateActions.find((a) => a.status === "Done");
      const workingAction = updateActions.find(
        (a) => a.status === "In progress",
      );

      expect(doneAction?.issueNumber).toBe(101);
      expect(workingAction?.issueNumber).toBe(102);

      // Should assign to next sub-issue
      const assignAction = actions.find((a) => a.type === "assignUser") as any;
      expect(assignAction.issueNumber).toBe(102);
    });

    test("assigns current sub-issue when no advancement needed", () => {
      const context = createContext({
        issue: {
          number: 100,
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 101,
              title: "Phase 1",
              state: "OPEN",
              body: "",
              projectStatus: "In progress",
              branch: null,
              pr: null,
              todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
            },
          ],
        },
        currentSubIssue: {
          number: 101,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
        currentPhase: 1,
        totalPhases: 1,
        botUsername: "nopo-bot",
      } as any);

      const actions = emitOrchestrate({ context });

      // Should NOT advance (todos not done), just assign current sub-issue
      const assignAction = actions.find((a) => a.type === "assignUser") as any;
      expect(assignAction.issueNumber).toBe(101);

      // Should not have closeIssue for current sub-issue
      const closeActions = actions.filter((a) => a.type === "closeIssue");
      expect(closeActions).toHaveLength(0);
    });
  });

  describe("emitAllPhasesDone", () => {
    test("marks parent Done and closes it", () => {
      const context = createContext({
        issue: {
          number: 100,
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            {
              number: 101,
              state: "CLOSED",
              projectStatus: "Done",
            },
            {
              number: 102,
              state: "CLOSED",
              projectStatus: "Done",
            },
          ],
        },
      } as any);

      const actions = emitAllPhasesDone({ context });

      const actionTypes = actions.map((a) => a.type);

      expect(actionTypes).toContain("log");
      expect(actionTypes).toContain("updateProjectStatus");
      expect(actionTypes).toContain("closeIssue");
      expect(actionTypes).toContain("appendHistory");

      // Check updateProjectStatus sets to Done
      const statusAction = actions.find(
        (a) => a.type === "updateProjectStatus",
      ) as any;
      expect(statusAction.issueNumber).toBe(100);
      expect(statusAction.status).toBe("Done");

      // Check closeIssue
      const closeAction = actions.find((a) => a.type === "closeIssue") as any;
      expect(closeAction.issueNumber).toBe(100);
      expect(closeAction.reason).toBe("completed");
    });
  });

  describe("emitAssignToSubIssue", () => {
    test("assigns bot to current sub-issue", () => {
      const context = createContext({
        currentSubIssue: {
          number: 101,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
        },
        botUsername: "nopo-bot",
      } as any);

      const actions = emitAssignToSubIssue({ context });

      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: "assignUser",
        issueNumber: 101,
        username: "nopo-bot",
      });
    });

    test("returns empty when no current sub-issue", () => {
      const context = createContext({
        currentSubIssue: null,
        botUsername: "nopo-bot",
      } as any);

      const actions = emitAssignToSubIssue({ context });

      expect(actions).toHaveLength(0);
    });
  });
});
