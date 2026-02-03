import { describe, test, expect } from "vitest";
import {
  parseDescription,
  parseApproach,
  parseParentIssue,
  parseSubIssue,
  serializeParentIssueBody,
  serializeSubIssueBody,
  serializeTodos,
  getParentIssueBody,
  getSubIssueBody,
} from "../../parser/issue-serializer.js";
import type {
  TodoItem,
  HistoryEntry,
  SubIssue,
  ParentIssue,
} from "../../schemas/index.js";

describe("parseDescription", () => {
  test("parses description from explicit section", () => {
    const body = `## Description

This is the description text.

## Approach

Implementation details.`;

    expect(parseDescription(body)).toBe("This is the description text.");
  });

  test("handles multiline descriptions", () => {
    const body = `## Description

First paragraph of description.

Second paragraph with more details.

## Approach

Something else.`;

    expect(parseDescription(body)).toBe(
      "First paragraph of description.\n\nSecond paragraph with more details.",
    );
  });

  test("returns whole body if no description section", () => {
    const body = "Just some plain text without sections.";
    expect(parseDescription(body)).toBe(
      "Just some plain text without sections.",
    );
  });

  test("handles body with only description section", () => {
    const body = `## Description

The entire body is description.`;

    expect(parseDescription(body)).toBe("The entire body is description.");
  });

  test("stops at history markers", () => {
    const body = `## Description

Description text.

<!-- iteration_history_start -->
| Time | # | Phase | Action | SHA | Run |
<!-- iteration_history_end -->`;

    expect(parseDescription(body)).toBe("Description text.");
  });

  test("handles empty description section", () => {
    const body = `## Description

## Approach

The approach section.`;

    // The description section exists but is empty - return empty string
    expect(parseDescription(body)).toBe("");
  });
});

describe("parseApproach", () => {
  test("parses approach from explicit section", () => {
    const body = `## Description

Description text.

## Approach

This is the approach.

## Todo

- [ ] Task`;

    expect(parseApproach(body)).toBe("This is the approach.");
  });

  test("handles multiline approach", () => {
    const body = `## Description

Desc.

## Approach

First step.

Second step.

## Todo

- [ ] Task`;

    expect(parseApproach(body)).toBe("First step.\n\nSecond step.");
  });

  test("returns null if no approach section", () => {
    const body = `## Description

Just description.

## Todo

- [ ] Task`;

    expect(parseApproach(body)).toBeNull();
  });

  test("handles approach at end of body", () => {
    const body = `## Description

Desc.

## Approach

Final approach content.`;

    expect(parseApproach(body)).toBe("Final approach content.");
  });
});

describe("serializeTodos", () => {
  test("serializes unchecked todos", () => {
    const todos: TodoItem[] = [
      { text: "First task", checked: false, isManual: false },
      { text: "Second task", checked: false, isManual: false },
    ];
    expect(serializeTodos(todos)).toBe("- [ ] First task\n- [ ] Second task");
  });

  test("serializes checked todos", () => {
    const todos: TodoItem[] = [
      { text: "Done task", checked: true, isManual: false },
    ];
    expect(serializeTodos(todos)).toBe("- [x] Done task");
  });

  test("serializes manual todos with prefix", () => {
    const todos: TodoItem[] = [
      { text: "Manual verification", checked: false, isManual: true },
    ];
    expect(serializeTodos(todos)).toBe("- [ ] [Manual] Manual verification");
  });

  test("serializes mixed todos", () => {
    const todos: TodoItem[] = [
      { text: "Regular task", checked: false, isManual: false },
      { text: "Done task", checked: true, isManual: false },
      { text: "Manual task", checked: false, isManual: true },
    ];
    expect(serializeTodos(todos)).toBe(
      "- [ ] Regular task\n- [x] Done task\n- [ ] [Manual] Manual task",
    );
  });

  test("handles empty array", () => {
    expect(serializeTodos([])).toBe("");
  });
});

describe("serializeParentIssueBody", () => {
  test("serializes description and approach", () => {
    const result = serializeParentIssueBody({
      description: "Test description.",
      approach: "Test approach.",
      history: [],
    });

    expect(result).toContain("## Description\n\nTest description.");
    expect(result).toContain("## Approach\n\nTest approach.");
    expect(result).toContain("## Iteration History");
  });

  test("omits approach if null", () => {
    const result = serializeParentIssueBody({
      description: "Description only.",
      approach: null,
      history: [],
    });

    expect(result).toContain("## Description\n\nDescription only.");
    expect(result).not.toContain("## Approach");
    expect(result).toContain("## Iteration History");
  });

  test("includes empty history markers when no history", () => {
    const result = serializeParentIssueBody({
      description: "Desc",
      approach: null,
      history: [],
    });

    expect(result).toContain("<!-- iteration_history_start -->");
    expect(result).toContain("<!-- iteration_history_end -->");
  });

  test("includes history table when history exists", () => {
    const history: HistoryEntry[] = [
      {
        iteration: 1,
        phase: "1",
        action: "Started",
        timestamp: "Jan 1 10:00",
        sha: "abc123",
        runLink: "https://github.com/run/1",
      },
    ];

    const result = serializeParentIssueBody({
      description: "Desc",
      approach: "Approach",
      history,
    });

    expect(result).toContain("## Iteration History");
    expect(result).toContain("| Time |");
    expect(result).toContain("Started");
  });
});

describe("serializeSubIssueBody", () => {
  test("serializes description and todos", () => {
    const todos: TodoItem[] = [
      { text: "Task 1", checked: false, isManual: false },
      { text: "Task 2", checked: true, isManual: false },
    ];

    const result = serializeSubIssueBody({
      description: "Sub-issue description.",
      todos,
    });

    expect(result).toContain("## Description\n\nSub-issue description.");
    expect(result).toContain("## Todo\n\n");
    expect(result).toContain("- [ ] Task 1");
    expect(result).toContain("- [x] Task 2");
  });

  test("handles empty todos", () => {
    const result = serializeSubIssueBody({
      description: "Description",
      todos: [],
    });

    expect(result).toContain("## Description\n\nDescription");
    expect(result).toContain("## Todo\n\n");
  });
});

describe("parseParentIssue", () => {
  test("parses all fields from API format", () => {
    const api = {
      number: 123,
      title: "Test Issue",
      body: `## Description

Test description here.

## Approach

Test approach.

## Todo

- [ ] Task 1
- [x] Task 2

## Iteration History

<!-- iteration_history_start -->
<!-- iteration_history_end -->`,
      state: "OPEN",
    };

    const projectFields = {
      status: "In progress" as const,
      iteration: 2,
      failures: 0,
    };
    const subIssues: SubIssue[] = [];
    const assignees = ["user1"];
    const labels = ["bug"];

    const result = parseParentIssue(
      api,
      projectFields,
      subIssues,
      assignees,
      labels,
    );

    expect(result.number).toBe(123);
    expect(result.title).toBe("Test Issue");
    expect(result.state).toBe("OPEN");
    expect(result.body).toBe(api.body);
    expect(result.description).toBe("Test description here.");
    expect(result.approach).toBe("Test approach.");
    expect(result.projectStatus).toBe("In progress");
    expect(result.iteration).toBe(2);
    expect(result.failures).toBe(0);
    expect(result.assignees).toEqual(["user1"]);
    expect(result.labels).toEqual(["bug"]);
    expect(result.subIssues).toEqual([]);
    expect(result.hasSubIssues).toBe(false);
    expect(result.todoStats.total).toBe(2);
    expect(result.todoStats.completed).toBe(1);
    expect(result.todos).toEqual(result.todoStats); // Backward compatibility
  });

  test("handles empty body", () => {
    const api = {
      number: 1,
      title: "Empty",
      body: "",
      state: "OPEN",
    };

    const result = parseParentIssue(
      api,
      { status: null, iteration: 0, failures: 0 },
      [],
      [],
      [],
    );

    expect(result.description).toBe("");
    expect(result.approach).toBeNull();
    expect(result.history).toEqual([]);
    expect(result.todoStats).toEqual({
      total: 0,
      completed: 0,
      uncheckedNonManual: 0,
    });
  });
});

describe("parseSubIssue", () => {
  test("parses all fields from API format", () => {
    const api = {
      number: 456,
      title: "[Phase 1] Implementation",
      body: `## Description

Implement the feature.

## Todo

- [ ] Write code
- [x] Add tests
- [ ] [Manual] Deploy`,
      state: "OPEN",
    };

    const result = parseSubIssue(
      api,
      "In progress",
      "claude/issue/123/phase-1",
      null,
    );

    expect(result.number).toBe(456);
    expect(result.title).toBe("[Phase 1] Implementation");
    expect(result.state).toBe("OPEN");
    expect(result.body).toBe(api.body);
    expect(result.description).toBe("Implement the feature.");
    expect(result.projectStatus).toBe("In progress");
    expect(result.branch).toBe("claude/issue/123/phase-1");
    expect(result.pr).toBeNull();
    expect(result.todos).toHaveLength(3);
    expect(result.todos[0]).toEqual({
      text: "Write code",
      checked: false,
      isManual: false,
    });
    expect(result.todos[1]).toEqual({
      text: "Add tests",
      checked: true,
      isManual: false,
    });
    expect(result.todos[2]).toEqual({
      text: "[Manual] Deploy",
      checked: false,
      isManual: true,
    });
    expect(result.todoStats).toEqual({
      total: 3,
      completed: 1,
      uncheckedNonManual: 1,
    });
  });

  test("handles lowercase state", () => {
    const api = {
      number: 1,
      title: "Test",
      body: "",
      state: "closed",
    };

    const result = parseSubIssue(api, null, null, null);
    expect(result.state).toBe("CLOSED");
  });
});

describe("getParentIssueBody", () => {
  test("extracts structured fields and re-serializes", () => {
    const issue = {
      number: 1,
      title: "Test",
      state: "OPEN" as const,
      body: "original body",
      description: "New description",
      approach: "New approach",
      history: [],
      todoStats: { total: 0, completed: 0, uncheckedNonManual: 0 },
      todos: { total: 0, completed: 0, uncheckedNonManual: 0 },
      projectStatus: null,
      iteration: 0,
      failures: 0,
      assignees: [],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
    } as ParentIssue;

    const body = getParentIssueBody(issue);

    expect(body).toContain("## Description\n\nNew description");
    expect(body).toContain("## Approach\n\nNew approach");
    expect(body).toContain("## Iteration History");
  });
});

describe("getSubIssueBody", () => {
  test("extracts structured fields and re-serializes", () => {
    const subIssue = {
      number: 1,
      title: "Test",
      state: "OPEN" as const,
      body: "original",
      description: "Sub description",
      todos: [
        { text: "Task A", checked: false, isManual: false },
        { text: "Task B", checked: true, isManual: false },
      ],
      todoStats: { total: 2, completed: 1, uncheckedNonManual: 1 },
      projectStatus: null,
      branch: null,
      pr: null,
    } as SubIssue;

    const body = getSubIssueBody(subIssue);

    expect(body).toContain("## Description\n\nSub description");
    expect(body).toContain("## Todo");
    expect(body).toContain("- [ ] Task A");
    expect(body).toContain("- [x] Task B");
  });
});

describe("round-trip parsing", () => {
  test("parse then serialize preserves content for parent issue", () => {
    const originalBody = `## Description

A test description with multiple lines.

And more content.

## Approach

The approach section.

## Iteration History

<!-- iteration_history_start -->
<!-- iteration_history_end -->`;

    // Parse
    const description = parseDescription(originalBody);
    const approach = parseApproach(originalBody);

    // Serialize
    const serialized = serializeParentIssueBody({
      description,
      approach,
      history: [],
    });

    // Key content should be preserved
    expect(serialized).toContain("A test description with multiple lines.");
    expect(serialized).toContain("And more content.");
    expect(serialized).toContain("The approach section.");
    expect(serialized).toContain("## Iteration History");
  });

  test("serialize then parse preserves content for sub-issue", () => {
    const todos: TodoItem[] = [
      { text: "Write implementation", checked: false, isManual: false },
      { text: "Add unit tests", checked: true, isManual: false },
      { text: "Manual QA", checked: false, isManual: true },
    ];

    // Serialize
    const body = serializeSubIssueBody({
      description: "Implementation phase.",
      todos,
    });

    // Parse
    const parsedDescription = parseDescription(body);
    // We would need to import parseTodos to fully test this
    // but we can at least verify the structure

    expect(parsedDescription).toBe("Implementation phase.");
    expect(body).toContain("- [ ] Write implementation");
    expect(body).toContain("- [x] Add unit tests");
    expect(body).toContain("- [ ] [Manual] Manual QA");
  });
});
