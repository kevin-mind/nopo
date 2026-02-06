import { describe, it, expect } from "vitest";
import { parseBody } from "../../src/markdown/body-parser.js";

const FULL_BODY = `This is the description text.

## Approach

Use TDD pattern.

## Todo

- [ ] Write tests
- [x] Set up project
- [ ] [Manual] Review code

## Iteration History

| Time | # | Phase | Action | SHA | Run |
|---|---|---|---|---|---|
| Jan 22 19:04 | 1 | 1 | Started | - | - |

## Agent Notes

### [Run 12345](https://github.com/o/r/actions/runs/12345) - Jan 22 19:04
- Found issue in auth`;

describe("parseBody", () => {
  it("parses full body into structured fields", () => {
    const result = parseBody(FULL_BODY);

    expect(result.description).toBe("This is the description text.");
    expect(result.approach).toBe("Use TDD pattern.");

    expect(result.todos).toHaveLength(3);
    expect(result.todos[0]!.text).toBe("Write tests");
    expect(result.todos[1]!.checked).toBe(true);
    expect(result.todos[2]!.isManual).toBe(true);

    expect(result.todoStats).toEqual({
      total: 3,
      completed: 1,
      uncheckedNonManual: 1,
    });

    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.action).toBe("Started");

    expect(result.agentNotes).toHaveLength(1);
    expect(result.agentNotes[0]!.runId).toBe("12345");

    expect(result.sections.length).toBeGreaterThanOrEqual(3);
    expect(result.sections.map((s) => s.name)).toContain("Approach");
    expect(result.sections.map((s) => s.name)).toContain("Todo");
  });

  it("handles empty body", () => {
    const result = parseBody("");
    expect(result.description).toBeNull();
    expect(result.todos).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.agentNotes).toEqual([]);
    expect(result.sections).toEqual([]);
  });

  it("handles body with only description", () => {
    const result = parseBody("Just a description, nothing more.");
    expect(result.description).toBe("Just a description, nothing more.");
    expect(result.sections).toEqual([]);
  });
});
