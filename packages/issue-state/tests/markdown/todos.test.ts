import { describe, it, expect } from "vitest";
import {
  parseTodoLine,
  parseTodos,
  calculateTodoStats,
  parseTodoStats,
  parseTodosInSection,
  updateTodoInBody,
  addTodoToBody,
} from "../../src/markdown/todos.js";

describe("parseTodoLine", () => {
  it("parses unchecked todo", () => {
    const result = parseTodoLine("- [ ] Do the thing");
    expect(result).toEqual({ text: "Do the thing", checked: false, isManual: false });
  });

  it("parses checked todo", () => {
    const result = parseTodoLine("- [x] Done thing");
    expect(result).toEqual({ text: "Done thing", checked: true, isManual: false });
  });

  it("parses uppercase X", () => {
    const result = parseTodoLine("- [X] Done thing");
    expect(result).toEqual({ text: "Done thing", checked: true, isManual: false });
  });

  it("detects [Manual] tag", () => {
    const result = parseTodoLine("- [ ] [Manual] Review the PR");
    expect(result?.isManual).toBe(true);
  });

  it("detects *(manual)* legacy tag", () => {
    const result = parseTodoLine("- [ ] *(manual)* Review the PR");
    expect(result?.isManual).toBe(true);
  });

  it("returns null for non-todo lines", () => {
    expect(parseTodoLine("Just text")).toBeNull();
    expect(parseTodoLine("- bullet")).toBeNull();
    expect(parseTodoLine("")).toBeNull();
  });
});

describe("parseTodos", () => {
  it("parses multiple todos from body", () => {
    const body = `Some text

- [ ] First
- [x] Second
- [ ] Third`;

    const todos = parseTodos(body);
    expect(todos).toHaveLength(3);
    expect(todos[0]!.checked).toBe(false);
    expect(todos[1]!.checked).toBe(true);
  });
});

describe("calculateTodoStats", () => {
  it("calculates correct stats", () => {
    const todos = [
      { text: "A", checked: true, isManual: false },
      { text: "B", checked: false, isManual: false },
      { text: "C", checked: false, isManual: true },
    ];
    const stats = calculateTodoStats(todos);
    expect(stats).toEqual({ total: 3, completed: 1, uncheckedNonManual: 1 });
  });

  it("handles empty list", () => {
    const stats = calculateTodoStats([]);
    expect(stats).toEqual({ total: 0, completed: 0, uncheckedNonManual: 0 });
  });
});

describe("parseTodoStats", () => {
  it("parses and computes stats in one call", () => {
    const body = "- [ ] First\n- [x] Second";
    const stats = parseTodoStats(body);
    expect(stats).toEqual({ total: 2, completed: 1, uncheckedNonManual: 1 });
  });
});

describe("parseTodosInSection", () => {
  it("extracts todos from a specific section", () => {
    const body = `## Description

Some text

## Todo

- [ ] Task A
- [x] Task B

## Other

- [ ] Not in todo section`;

    const todos = parseTodosInSection(body, "Todo");
    expect(todos).toHaveLength(2);
    expect(todos[0]!.text).toBe("Task A");
    expect(todos[1]!.text).toBe("Task B");
  });
});

describe("updateTodoInBody", () => {
  it("checks an unchecked todo", () => {
    const body = "- [ ] Fix bug\n- [x] Done thing";
    const result = updateTodoInBody(body, "Fix bug", true);
    expect(result).toContain("- [x] Fix bug");
  });

  it("unchecks a checked todo", () => {
    const body = "- [x] Fix bug";
    const result = updateTodoInBody(body, "Fix bug", false);
    expect(result).toContain("- [ ] Fix bug");
  });

  it("returns null if todo not found", () => {
    const result = updateTodoInBody("- [ ] Other", "Missing", true);
    expect(result).toBeNull();
  });
});

describe("addTodoToBody", () => {
  it("adds to existing Todos section", () => {
    const body = "## Todos\n\n- [ ] Existing";
    const result = addTodoToBody(body, "New task");
    expect(result).toContain("- [ ] New task");
  });

  it("creates Todos section if missing", () => {
    const body = "Some description";
    const result = addTodoToBody(body, "New task");
    expect(result).toContain("## Todos");
    expect(result).toContain("- [ ] New task");
  });

  it("adds checked todo", () => {
    const body = "## Todos\n\n- [ ] Existing";
    const result = addTodoToBody(body, "Done task", true);
    expect(result).toContain("- [x] Done task");
  });
});
