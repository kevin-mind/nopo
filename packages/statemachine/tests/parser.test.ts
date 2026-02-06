import { describe, it, expect } from "vitest";
import {
  parseTodoLine,
  parseTodos,
  parseTodoStats,
  countNonManualUncheckedTodos,
  areNonManualTodosDone,
  parseHistory,
  getLatestHistoryEntry,
  parseAgentNotes,
  formatAgentNotesForPrompt,
} from "../src/parser/index.js";

describe("todo-parser", () => {
  describe("parseTodoLine", () => {
    it("parses unchecked todo", () => {
      const result = parseTodoLine("- [ ] Do something");
      expect(result).toEqual({
        text: "Do something",
        checked: false,
        isManual: false,
      });
    });

    it("parses checked todo", () => {
      const result = parseTodoLine("- [x] Done task");
      expect(result).toEqual({
        text: "Done task",
        checked: true,
        isManual: false,
      });
    });

    it("parses manual todo with [Manual] prefix", () => {
      const result = parseTodoLine("- [ ] [Manual] Verify deployment");
      expect(result).toEqual({
        text: "[Manual] Verify deployment",
        checked: false,
        isManual: true,
      });
    });

    it("parses manual todo with legacy *(manual)* format", () => {
      const result = parseTodoLine("- [ ] *(manual)* Test in staging");
      expect(result).toEqual({
        text: "*(manual)* Test in staging",
        checked: false,
        isManual: true,
      });
    });

    it("returns null for non-todo lines", () => {
      expect(parseTodoLine("Some regular text")).toBeNull();
      expect(parseTodoLine("## Header")).toBeNull();
      expect(parseTodoLine("")).toBeNull();
    });
  });

  describe("parseTodos", () => {
    it("parses multiple todos from body", () => {
      const body = `## Todos

- [ ] Task 1
- [x] Task 2
- [ ] [Manual] Task 3
`;
      const todos = parseTodos(body);
      expect(todos).toHaveLength(3);
      expect(todos[0]).toEqual({
        text: "Task 1",
        checked: false,
        isManual: false,
      });
      expect(todos[1]).toEqual({
        text: "Task 2",
        checked: true,
        isManual: false,
      });
      expect(todos[2]).toEqual({
        text: "[Manual] Task 3",
        checked: false,
        isManual: true,
      });
    });
  });

  describe("parseTodoStats", () => {
    it("calculates correct stats", () => {
      const body = `
- [ ] Task 1
- [x] Task 2
- [ ] [Manual] Task 3
- [ ] Task 4
`;
      const stats = parseTodoStats(body);
      expect(stats).toEqual({
        total: 4,
        completed: 1,
        uncheckedNonManual: 2,
      });
    });
  });

  describe("countNonManualUncheckedTodos", () => {
    it("counts only non-manual unchecked todos", () => {
      const body = `
- [ ] Task 1
- [x] Task 2
- [ ] [Manual] Task 3
`;
      expect(countNonManualUncheckedTodos(body)).toBe(1);
    });
  });

  describe("areNonManualTodosDone", () => {
    it("returns true when all non-manual todos are done", () => {
      const body = `
- [x] Task 1
- [ ] [Manual] Task 2
`;
      expect(areNonManualTodosDone(body)).toBe(true);
    });

    it("returns false when non-manual todos are incomplete", () => {
      const body = `
- [ ] Task 1
- [x] Task 2
`;
      expect(areNonManualTodosDone(body)).toBe(false);
    });
  });
});

describe("history-parser", () => {
  describe("parseHistory", () => {
    it("parses history table", () => {
      const body = `## Some content

## Iteration History

| Time | # | Phase | Action | SHA | Run |
|---|---|---|---|---|---|
| Jan 22 19:04 | 1 | 1 | Started | [\`abc123\`](https://github.com/owner/repo/commit/abc123) | [12345](https://github.com/owner/repo/actions/runs/12345) |
| Jan 22 19:10 | 2 | 1 | Completed | - | - |
`;
      const history = parseHistory(body);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        iteration: 1,
        phase: "1",
        action: "Started",
        timestamp: "Jan 22 19:04",
        sha: "abc123",
        runLink: "https://github.com/owner/repo/actions/runs/12345",
      });
      expect(history[1]).toEqual({
        iteration: 2,
        phase: "1",
        action: "Completed",
        timestamp: "Jan 22 19:10",
        sha: null,
        runLink: null,
      });
    });

    it("returns empty array when no history section", () => {
      const body = `## Some content

No history here.
`;
      expect(parseHistory(body)).toEqual([]);
    });
  });

  describe("getLatestHistoryEntry", () => {
    it("returns last entry", () => {
      const body = `## Iteration History

| Time | # | Phase | Action | SHA | Run |
|---|---|---|---|---|---|
| Jan 22 19:04 | 1 | 1 | First | - | - |
| Jan 22 19:10 | 2 | 1 | Last | - | - |
`;
      const latest = getLatestHistoryEntry(body);
      expect(latest?.iteration).toBe(2);
      expect(latest?.action).toBe("Last");
    });

    it("returns null when no history", () => {
      expect(getLatestHistoryEntry("No history")).toBeNull();
    });
  });
});

describe("agent-notes-parser", () => {
  describe("parseAgentNotes", () => {
    it("parses agent notes entries", () => {
      const body = `## Some content

## Agent Notes

### [Run 12345678901](https://github.com/owner/repo/actions/runs/12345678901) - Jan 22 19:04

- First note
- Second note

### [Run 98765432101](https://github.com/owner/repo/actions/runs/98765432101) - Jan 22 19:10

- Another note
`;
      const entries = parseAgentNotes(body);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        runId: "12345678901",
        runLink: "https://github.com/owner/repo/actions/runs/12345678901",
        timestamp: "Jan 22 19:04",
        notes: ["First note", "Second note"],
      });
      expect(entries[1]).toEqual({
        runId: "98765432101",
        runLink: "https://github.com/owner/repo/actions/runs/98765432101",
        timestamp: "Jan 22 19:10",
        notes: ["Another note"],
      });
    });

    it("returns empty array when no agent notes section", () => {
      expect(parseAgentNotes("No notes")).toEqual([]);
    });
  });

  describe("formatAgentNotesForPrompt", () => {
    it("formats entries for prompt", () => {
      const entries = [
        {
          runId: "123",
          runLink: "https://example.com/runs/123",
          timestamp: "Jan 22 19:04",
          notes: ["Note 1", "Note 2"],
        },
      ];
      const formatted = formatAgentNotesForPrompt(entries);
      expect(formatted).toContain("### [Run 123]");
      expect(formatted).toContain("- Note 1");
      expect(formatted).toContain("- Note 2");
    });

    it("returns message when no entries", () => {
      expect(formatAgentNotesForPrompt([])).toBe(
        "No previous agent notes found for this issue.",
      );
    });
  });
});
