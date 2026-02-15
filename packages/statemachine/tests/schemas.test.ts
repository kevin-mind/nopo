import { describe, it, expect } from "vitest";
import {
  ActionSchema,
  isTerminalAction,
  createMachineContext,
  isTerminalStatus,
  ProjectStatusSchema,
  ParentIssueSchema,
  TodoStatsSchema,
} from "../src/core/schemas/index.js";
import { parseMarkdown } from "@more/issue-state";

describe("schemas", () => {
  describe("ActionSchema", () => {
    it("parses a valid updateProjectStatus action", () => {
      const action = {
        type: "updateProjectStatus",
        issueNumber: 123,
        status: "In progress",
      };
      const result = ActionSchema.parse(action);
      expect(result.type).toBe("updateProjectStatus");
      if (result.type === "updateProjectStatus") {
        expect(result.issueNumber).toBe(123);
      }
    });

    it("applies default token value", () => {
      const action = ActionSchema.parse({
        type: "updateProjectStatus",
        issueNumber: 123,
        status: "Done",
      });
      expect(action.token).toBe("code");
    });

    it("rejects invalid action type", () => {
      const action = {
        type: "invalidAction",
        issueNumber: 123,
      };
      expect(() => ActionSchema.parse(action)).toThrow();
    });
  });

  describe("isTerminalAction", () => {
    it("returns true for stop action", () => {
      const action = ActionSchema.parse({
        type: "stop",
        message: "test",
      });
      expect(isTerminalAction(action)).toBe(true);
    });

    it("returns true for block action", () => {
      const action = ActionSchema.parse({
        type: "block",
        issueNumber: 123,
        message: "test",
      });
      expect(isTerminalAction(action)).toBe(true);
    });

    it("returns false for non-terminal actions", () => {
      const action = ActionSchema.parse({
        type: "log",
        message: "test",
      });
      expect(isTerminalAction(action)).toBe(false);
    });
  });

  describe("createMachineContext", () => {
    it("creates context with defaults", () => {
      const issue = ParentIssueSchema.parse({
        number: 123,
        title: "Test Issue",
        state: "OPEN",
        bodyAst: parseMarkdown("Test body"),
        projectStatus: "In progress",
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

      const context = createMachineContext({
        trigger: "issue-assigned",
        owner: "test-owner",
        repo: "test-repo",
        issue,
      });

      expect(context.owner).toBe("test-owner");
      expect(context.repo).toBe("test-repo");
      expect(context.trigger).toBe("issue-assigned");
      expect(context.parentIssue).toBeNull();
      expect(context.maxRetries).toBe(5);
      expect(context.botUsername).toBe("nopo-bot");
    });
  });

  describe("isTerminalStatus", () => {
    it("returns true for Done", () => {
      expect(isTerminalStatus("Done")).toBe(true);
    });

    it("returns true for Blocked", () => {
      expect(isTerminalStatus("Blocked")).toBe(true);
    });

    it("returns true for Error", () => {
      expect(isTerminalStatus("Error")).toBe(true);
    });

    it("returns false for In progress", () => {
      expect(isTerminalStatus("In progress")).toBe(false);
    });
  });

  describe("ProjectStatusSchema", () => {
    it("parses valid statuses", () => {
      expect(ProjectStatusSchema.parse("Backlog")).toBe("Backlog");
      expect(ProjectStatusSchema.parse("In progress")).toBe("In progress");
      expect(ProjectStatusSchema.parse("Done")).toBe("Done");
    });

    it("rejects invalid status", () => {
      expect(() => ProjectStatusSchema.parse("Invalid")).toThrow();
    });
  });

  describe("TodoStatsSchema", () => {
    it("parses valid todo stats", () => {
      const stats = TodoStatsSchema.parse({
        total: 5,
        completed: 3,
        uncheckedNonManual: 2,
      });
      expect(stats.total).toBe(5);
      expect(stats.completed).toBe(3);
      expect(stats.uncheckedNonManual).toBe(2);
    });

    it("rejects negative values", () => {
      expect(() =>
        TodoStatsSchema.parse({
          total: -1,
          completed: 0,
          uncheckedNonManual: 0,
        }),
      ).toThrow();
    });
  });
});
