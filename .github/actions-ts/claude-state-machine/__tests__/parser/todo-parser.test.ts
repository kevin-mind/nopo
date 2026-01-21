import { describe, test, expect } from "vitest";
import {
  parseTodoLine,
  parseTodos,
  calculateTodoStats,
  parseTodoStats,
  countNonManualUncheckedTodos,
  areNonManualTodosDone,
  parseTodosInSection,
  parseTodoStatsInSection,
  parseTodoSection,
  parseTestingSection,
  updateTodoInBody,
  addTodoToBody,
} from "../../parser/todo-parser.js";

describe("parseTodoLine", () => {
  test("parses unchecked todo", () => {
    const result = parseTodoLine("- [ ] Do something");
    expect(result).toEqual({
      text: "Do something",
      checked: false,
      isManual: false,
    });
  });

  test("parses checked todo with lowercase x", () => {
    const result = parseTodoLine("- [x] Done task");
    expect(result).toEqual({
      text: "Done task",
      checked: true,
      isManual: false,
    });
  });

  test("parses checked todo with uppercase X", () => {
    const result = parseTodoLine("- [X] Also done");
    expect(result).toEqual({
      text: "Also done",
      checked: true,
      isManual: false,
    });
  });

  test("parses manual todo", () => {
    const result = parseTodoLine("- [ ] Manual task *(manual)*");
    expect(result).toEqual({
      text: "Manual task *(manual)*",
      checked: false,
      isManual: true,
    });
  });

  test("parses manual todo with different casing", () => {
    const result = parseTodoLine("- [ ] Test *(MANUAL)*");
    expect(result?.isManual).toBe(true);
  });

  test("handles indented todos", () => {
    const result = parseTodoLine("    - [ ] Nested task");
    expect(result).toEqual({
      text: "Nested task",
      checked: false,
      isManual: false,
    });
  });

  test("returns null for non-todo lines", () => {
    expect(parseTodoLine("Regular text")).toBeNull();
    expect(parseTodoLine("## Header")).toBeNull();
    expect(parseTodoLine("* Bullet point")).toBeNull();
    expect(parseTodoLine("")).toBeNull();
  });

  test("returns null for malformed todos", () => {
    expect(parseTodoLine("- []")).toBeNull();
    expect(parseTodoLine("- [] ")).toBeNull();
    // Note: The regex allows optional whitespace between - and [, so -[ ] text is valid
    expect(parseTodoLine("[ ] text")).toBeNull(); // Missing the hyphen entirely
    expect(parseTodoLine("text - [ ]")).toBeNull(); // Wrong order
  });
});

describe("parseTodos", () => {
  test("parses multiple todos from body", () => {
    const body = `
## Todos

- [ ] First task
- [x] Second task
- [ ] Third task *(manual)*
`;
    const todos = parseTodos(body);
    expect(todos).toHaveLength(3);
    expect(todos[0]).toEqual({
      text: "First task",
      checked: false,
      isManual: false,
    });
    expect(todos[1]).toEqual({
      text: "Second task",
      checked: true,
      isManual: false,
    });
    expect(todos[2]).toEqual({
      text: "Third task *(manual)*",
      checked: false,
      isManual: true,
    });
  });

  test("handles empty body", () => {
    expect(parseTodos("")).toHaveLength(0);
  });

  test("handles body with no todos", () => {
    const body = `
## Description

Just some text here.
No todos at all.
`;
    expect(parseTodos(body)).toHaveLength(0);
  });

  test("finds todos anywhere in the body", () => {
    const body = `
Some text
- [ ] Hidden todo
More text
`;
    const todos = parseTodos(body);
    expect(todos).toHaveLength(1);
    expect(todos[0]?.text).toBe("Hidden todo");
  });
});

describe("calculateTodoStats", () => {
  test("calculates correct stats", () => {
    const todos = [
      { text: "Task 1", checked: true, isManual: false },
      { text: "Task 2", checked: false, isManual: false },
      { text: "Task 3", checked: false, isManual: true },
      { text: "Task 4", checked: true, isManual: false },
    ];
    const stats = calculateTodoStats(todos);
    expect(stats).toEqual({
      total: 4,
      completed: 2,
      uncheckedNonManual: 1,
    });
  });

  test("handles empty array", () => {
    expect(calculateTodoStats([])).toEqual({
      total: 0,
      completed: 0,
      uncheckedNonManual: 0,
    });
  });

  test("handles all completed", () => {
    const todos = [
      { text: "Done 1", checked: true, isManual: false },
      { text: "Done 2", checked: true, isManual: false },
    ];
    expect(calculateTodoStats(todos)).toEqual({
      total: 2,
      completed: 2,
      uncheckedNonManual: 0,
    });
  });

  test("handles all manual unchecked", () => {
    const todos = [
      { text: "Manual 1", checked: false, isManual: true },
      { text: "Manual 2", checked: false, isManual: true },
    ];
    expect(calculateTodoStats(todos)).toEqual({
      total: 2,
      completed: 0,
      uncheckedNonManual: 0,
    });
  });
});

describe("parseTodoStats", () => {
  test("parses and calculates in one call", () => {
    const body = `
- [x] Done
- [ ] Pending
- [ ] Manual *(manual)*
`;
    const stats = parseTodoStats(body);
    expect(stats).toEqual({
      total: 3,
      completed: 1,
      uncheckedNonManual: 1,
    });
  });
});

describe("countNonManualUncheckedTodos", () => {
  test("counts only non-manual unchecked todos", () => {
    const body = `
- [ ] Task 1
- [x] Task 2
- [ ] Task 3
- [ ] Manual *(manual)*
`;
    expect(countNonManualUncheckedTodos(body)).toBe(2);
  });
});

describe("areNonManualTodosDone", () => {
  test("returns true when all non-manual todos are done", () => {
    const body = `
- [x] Task 1
- [x] Task 2
- [ ] Manual *(manual)*
`;
    expect(areNonManualTodosDone(body)).toBe(true);
  });

  test("returns false when non-manual todos remain", () => {
    const body = `
- [x] Task 1
- [ ] Task 2
`;
    expect(areNonManualTodosDone(body)).toBe(false);
  });

  test("returns true for empty body", () => {
    expect(areNonManualTodosDone("")).toBe(true);
  });

  test("returns true when only manual todos remain", () => {
    const body = `
- [x] Done task
- [ ] Manual review *(manual)*
`;
    expect(areNonManualTodosDone(body)).toBe(true);
  });
});

describe("parseTodosInSection", () => {
  test("parses todos from specific section", () => {
    const body = `
## Description

Some description text.

## Todos

- [ ] First todo
- [x] Second todo

## Testing

- [ ] Test 1
- [ ] Test 2
`;
    const todos = parseTodosInSection(body, "Todos");
    expect(todos).toHaveLength(2);
    expect(todos[0]?.text).toBe("First todo");
    expect(todos[1]?.text).toBe("Second todo");
  });

  test("stops at next section", () => {
    const body = `
## Todos

- [ ] Only this one

## Other Section

- [ ] Should not include this
`;
    const todos = parseTodosInSection(body, "Todos");
    expect(todos).toHaveLength(1);
    expect(todos[0]?.text).toBe("Only this one");
  });

  test("returns empty array if section not found", () => {
    const body = `
## Different Section

- [ ] Some todo
`;
    expect(parseTodosInSection(body, "Todos")).toHaveLength(0);
  });

  test("is case-insensitive for section header", () => {
    const body = `
## TODOS

- [ ] Found it
`;
    expect(parseTodosInSection(body, "Todos")).toHaveLength(1);
  });
});

describe("parseTodoStatsInSection", () => {
  test("returns stats for specific section", () => {
    const body = `
## Todos

- [x] Done
- [ ] Pending

## Testing

- [ ] Test 1
`;
    const stats = parseTodoStatsInSection(body, "Todos");
    expect(stats).toEqual({
      total: 2,
      completed: 1,
      uncheckedNonManual: 1,
    });
  });
});

describe("parseTodoSection", () => {
  test("parses the Todos section specifically", () => {
    const body = `
## Todos

- [ ] Task

## Testing

- [ ] Test
`;
    const todos = parseTodoSection(body);
    expect(todos).toHaveLength(1);
    expect(todos[0]?.text).toBe("Task");
  });
});

describe("parseTestingSection", () => {
  test("parses the Testing section specifically", () => {
    const body = `
## Todos

- [ ] Task

## Testing

- [ ] Test case 1
- [x] Test case 2
`;
    const todos = parseTestingSection(body);
    expect(todos).toHaveLength(2);
    expect(todos[0]?.text).toBe("Test case 1");
    expect(todos[1]?.text).toBe("Test case 2");
  });
});

describe("updateTodoInBody", () => {
  test("checks a todo", () => {
    const body = "- [ ] Task to check";
    const result = updateTodoInBody(body, "Task to check", true);
    expect(result).toBe("- [x] Task to check");
  });

  test("unchecks a todo", () => {
    const body = "- [x] Task to uncheck";
    const result = updateTodoInBody(body, "Task to uncheck", false);
    expect(result).toBe("- [ ] Task to uncheck");
  });

  test("returns null if todo not found", () => {
    const body = "- [ ] Different task";
    const result = updateTodoInBody(body, "Not found", true);
    expect(result).toBeNull();
  });

  test("handles special regex characters in todo text", () => {
    const body = "- [ ] Task with (parentheses) and [brackets]";
    const result = updateTodoInBody(
      body,
      "Task with (parentheses) and [brackets]",
      true,
    );
    expect(result).toBe("- [x] Task with (parentheses) and [brackets]");
  });

  test("preserves other content", () => {
    const body = `
## Todos

- [ ] First
- [ ] Second
- [ ] Third
`;
    const result = updateTodoInBody(body, "Second", true);
    expect(result).toContain("- [ ] First");
    expect(result).toContain("- [x] Second");
    expect(result).toContain("- [ ] Third");
  });
});

describe("addTodoToBody", () => {
  test("adds todo to existing Todos section", () => {
    const body = `
## Todos

- [ ] Existing task
`;
    const result = addTodoToBody(body, "New task");
    expect(result).toContain("- [ ] Existing task");
    expect(result).toContain("- [ ] New task");
  });

  test("adds checked todo", () => {
    const body = `
## Todos

- [ ] Task
`;
    const result = addTodoToBody(body, "Done task", true);
    expect(result).toContain("- [x] Done task");
  });

  test("creates Todos section if not exists", () => {
    const body = "## Description\n\nSome text";
    const result = addTodoToBody(body, "First todo");
    expect(result).toContain("## Todos");
    expect(result).toContain("- [ ] First todo");
  });

  test("adds after last todo in section", () => {
    const body = `
## Todos

- [ ] First
- [ ] Second

## Other

Content
`;
    const result = addTodoToBody(body, "Third");
    const lines = result.split("\n");
    const firstIdx = lines.findIndex((l) => l.includes("First"));
    const secondIdx = lines.findIndex((l) => l.includes("Second"));
    const thirdIdx = lines.findIndex((l) => l.includes("Third"));

    expect(thirdIdx).toBeGreaterThan(secondIdx);
    expect(thirdIdx).toBeGreaterThan(firstIdx);
  });
});
