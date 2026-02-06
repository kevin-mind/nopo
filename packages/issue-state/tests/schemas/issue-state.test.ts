import { describe, it, expect } from "vitest";
import {
  ProjectStatusSchema,
  IssueStateSchema,
  PRStateSchema,
  CIStatusSchema,
  TodoItemSchema,
  HistoryEntrySchema,
  IssueCommentSchema,
  LinkedPRSchema,
  SubIssueDataSchema,
  IssueDataSchema,
  IssueStateDataSchema,
} from "../../src/schemas/index.js";

describe("enum schemas", () => {
  it("validates ProjectStatus values", () => {
    expect(ProjectStatusSchema.parse("Backlog")).toBe("Backlog");
    expect(ProjectStatusSchema.parse("In progress")).toBe("In progress");
    expect(() => ProjectStatusSchema.parse("Invalid")).toThrow();
  });

  it("validates IssueState values", () => {
    expect(IssueStateSchema.parse("OPEN")).toBe("OPEN");
    expect(IssueStateSchema.parse("CLOSED")).toBe("CLOSED");
    expect(() => IssueStateSchema.parse("open")).toThrow();
  });

  it("validates PRState values", () => {
    expect(PRStateSchema.parse("MERGED")).toBe("MERGED");
  });

  it("validates CIStatus values", () => {
    expect(CIStatusSchema.parse("SUCCESS")).toBe("SUCCESS");
    expect(CIStatusSchema.parse("PENDING")).toBe("PENDING");
  });
});

describe("TodoItemSchema", () => {
  it("validates a todo item", () => {
    const result = TodoItemSchema.parse({
      text: "Fix bug",
      checked: false,
      isManual: true,
    });
    expect(result.text).toBe("Fix bug");
  });
});

describe("HistoryEntrySchema", () => {
  it("validates with nullable fields", () => {
    const result = HistoryEntrySchema.parse({
      iteration: 1,
      phase: "1",
      action: "Started",
      timestamp: null,
      sha: null,
      runLink: null,
    });
    expect(result.iteration).toBe(1);
  });
});

describe("IssueCommentSchema", () => {
  it("validates a comment", () => {
    const result = IssueCommentSchema.parse({
      id: "IC_123",
      author: "nopo-bot",
      body: "Working on it",
      createdAt: "2026-01-22T19:04:52Z",
      isBot: true,
    });
    expect(result.isBot).toBe(true);
  });
});

describe("LinkedPRSchema", () => {
  it("validates a PR with null ciStatus", () => {
    const result = LinkedPRSchema.parse({
      number: 42,
      state: "OPEN",
      isDraft: true,
      title: "Fix auth",
      headRef: "claude/issue/1",
      baseRef: "main",
      ciStatus: null,
    });
    expect(result.number).toBe(42);
  });
});

describe("SubIssueDataSchema", () => {
  it("validates a sub-issue", () => {
    const result = SubIssueDataSchema.parse({
      number: 10,
      title: "[Phase 1]: Setup",
      state: "OPEN",
      body: "Do setup",
      projectStatus: "In progress",
      branch: "claude/issue/5/phase-1",
      pr: null,
      description: "Do setup",
      todos: [],
      todoStats: { total: 0, completed: 0, uncheckedNonManual: 0 },
      sections: [],
    });
    expect(result.number).toBe(10);
  });
});

describe("IssueDataSchema", () => {
  it("validates a full issue", () => {
    const result = IssueDataSchema.parse({
      number: 5,
      title: "Implement auth",
      state: "OPEN",
      body: "Implement OAuth",
      projectStatus: "In progress",
      iteration: 3,
      failures: 1,
      assignees: ["nopo-bot"],
      labels: ["enhancement"],
      subIssues: [],
      hasSubIssues: false,
      description: "Implement OAuth",
      approach: null,
      todos: [],
      todoStats: { total: 0, completed: 0, uncheckedNonManual: 0 },
      history: [],
      agentNotes: [],
      sections: [],
      comments: [],
      branch: "claude/issue/5",
      pr: null,
      parentIssueNumber: null,
    });
    expect(result.number).toBe(5);
    expect(result.iteration).toBe(3);
  });
});

describe("IssueStateDataSchema", () => {
  it("validates full state with parent", () => {
    const issue = {
      number: 10,
      title: "Sub-issue",
      state: "OPEN" as const,
      body: "",
      projectStatus: "In progress" as const,
      iteration: 1,
      failures: 0,
      assignees: [],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      description: null,
      approach: null,
      todos: [],
      todoStats: { total: 0, completed: 0, uncheckedNonManual: 0 },
      history: [],
      agentNotes: [],
      sections: [],
      comments: [],
      branch: "claude/issue/10",
      pr: null,
      parentIssueNumber: 5,
    };

    const result = IssueStateDataSchema.parse({
      owner: "kevin-mind",
      repo: "nopo",
      issue,
      parentIssue: null,
    });

    expect(result.owner).toBe("kevin-mind");
    expect(result.issue.number).toBe(10);
    expect(result.parentIssue).toBeNull();
  });
});
