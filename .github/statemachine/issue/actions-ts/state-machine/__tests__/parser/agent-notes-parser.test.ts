import { describe, test, expect } from "vitest";
import {
  parseAgentNotes,
  appendAgentNotes,
  formatAgentNotesForPrompt,
  removeAgentNotesSection,
  extractAgentNotesSection,
  AGENT_NOTES_SECTION,
} from "../../parser/agent-notes-parser.js";

describe("parseAgentNotes", () => {
  test("returns empty array for body without Agent Notes section", () => {
    const body = `## Description

Some issue description.

## Todo

- [ ] Task 1
- [ ] Task 2`;

    const notes = parseAgentNotes(body);
    expect(notes).toEqual([]);
  });

  test("parses single agent notes entry", () => {
    const body = `## Description

Some description.

## Agent Notes

### [Run 12345678901](https://github.com/owner/repo/actions/runs/12345678901) - Jan 22 19:04
- Note 1
- Note 2
- Note 3`;

    const notes = parseAgentNotes(body);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({
      runId: "12345678901",
      runLink: "https://github.com/owner/repo/actions/runs/12345678901",
      timestamp: "Jan 22 19:04",
      notes: ["Note 1", "Note 2", "Note 3"],
    });
  });

  test("parses multiple agent notes entries", () => {
    const body = `## Description

Some description.

## Agent Notes

### [Run 12345678902](https://github.com/owner/repo/actions/runs/12345678902) - Jan 22 20:15
- Note 4
- Note 5

### [Run 12345678901](https://github.com/owner/repo/actions/runs/12345678901) - Jan 22 19:04
- Note 1
- Note 2
- Note 3`;

    const notes = parseAgentNotes(body);
    expect(notes).toHaveLength(2);
    expect(notes[0].runId).toBe("12345678902");
    expect(notes[0].notes).toEqual(["Note 4", "Note 5"]);
    expect(notes[1].runId).toBe("12345678901");
    expect(notes[1].notes).toEqual(["Note 1", "Note 2", "Note 3"]);
  });

  test("handles notes with asterisk bullets", () => {
    const body = `## Agent Notes

### [Run 123](https://example.com/123) - Jan 1 00:00
* Note with asterisk
* Another asterisk note`;

    const notes = parseAgentNotes(body);
    expect(notes[0].notes).toEqual([
      "Note with asterisk",
      "Another asterisk note",
    ]);
  });
});

describe("appendAgentNotes", () => {
  test("creates Agent Notes section if not present", () => {
    const body = `## Description

Some description.`;

    const updated = appendAgentNotes(body, {
      runId: "12345",
      runLink: "https://example.com/12345",
      notes: ["Note 1", "Note 2"],
    });

    expect(updated).toContain("## Agent Notes");
    expect(updated).toContain("### [Run 12345](https://example.com/12345)");
    expect(updated).toContain("- Note 1");
    expect(updated).toContain("- Note 2");
  });

  test("prepends new entry to existing Agent Notes section", () => {
    const body = `## Description

Some description.

## Agent Notes

### [Run 111](https://example.com/111) - Jan 1 00:00
- Old note`;

    const updated = appendAgentNotes(body, {
      runId: "222",
      runLink: "https://example.com/222",
      notes: ["New note"],
    });

    // New entry should appear before old entry
    const newIndex = updated.indexOf("[Run 222]");
    const oldIndex = updated.indexOf("[Run 111]");
    expect(newIndex).toBeLessThan(oldIndex);
  });

  test("does not modify body if notes array is empty", () => {
    const body = `## Description

Some description.`;

    const updated = appendAgentNotes(body, {
      runId: "12345",
      runLink: "https://example.com/12345",
      notes: [],
    });

    expect(updated).toBe(body);
  });

  test("truncates notes longer than 500 characters", () => {
    const longNote = "A".repeat(600);
    const body = `## Description

Some description.`;

    const updated = appendAgentNotes(body, {
      runId: "12345",
      runLink: "https://example.com/12345",
      notes: [longNote],
    });

    // Note should be truncated to 500 chars + "..."
    expect(updated).toContain("A".repeat(500) + "...");
    expect(updated).not.toContain("A".repeat(501));
  });

  test("limits to 10 notes per entry", () => {
    const body = `## Description

Some description.`;

    const manyNotes = Array.from({ length: 15 }, (_, i) => `Note ${i + 1}`);

    const updated = appendAgentNotes(body, {
      runId: "12345",
      runLink: "https://example.com/12345",
      notes: manyNotes,
    });

    // Should only have 10 notes
    expect(updated).toContain("- Note 1");
    expect(updated).toContain("- Note 10");
    expect(updated).not.toContain("- Note 11");
  });
});

describe("formatAgentNotesForPrompt", () => {
  test("returns default message for empty entries", () => {
    const result = formatAgentNotesForPrompt([]);
    expect(result).toBe("No previous agent notes found for this issue.");
  });

  test("formats single entry", () => {
    const entries = [
      {
        runId: "123",
        runLink: "https://example.com/123",
        timestamp: "Jan 22 19:04",
        notes: ["Note 1", "Note 2"],
      },
    ];

    const result = formatAgentNotesForPrompt(entries);
    expect(result).toContain("### [Run 123](https://example.com/123) - Jan 22 19:04");
    expect(result).toContain("- Note 1");
    expect(result).toContain("- Note 2");
  });

  test("limits to 3 most recent entries", () => {
    const entries = [
      { runId: "1", runLink: "https://1", timestamp: "T1", notes: ["N1"] },
      { runId: "2", runLink: "https://2", timestamp: "T2", notes: ["N2"] },
      { runId: "3", runLink: "https://3", timestamp: "T3", notes: ["N3"] },
      { runId: "4", runLink: "https://4", timestamp: "T4", notes: ["N4"] },
    ];

    const result = formatAgentNotesForPrompt(entries);
    expect(result).toContain("[Run 1]");
    expect(result).toContain("[Run 2]");
    expect(result).toContain("[Run 3]");
    expect(result).not.toContain("[Run 4]");
  });
});

describe("removeAgentNotesSection", () => {
  test("removes Agent Notes section from body", () => {
    const body = `## Description

Some description.

## Agent Notes

### [Run 123](https://example.com/123) - Jan 22 19:04
- Note 1`;

    const result = removeAgentNotesSection(body);
    expect(result).toBe(`## Description

Some description.`);
    expect(result).not.toContain("Agent Notes");
  });

  test("returns unchanged body if no Agent Notes section", () => {
    const body = `## Description

Some description.`;

    const result = removeAgentNotesSection(body);
    expect(result).toBe(body);
  });
});

describe("extractAgentNotesSection", () => {
  test("extracts Agent Notes section from body", () => {
    const body = `## Description

Some description.

## Agent Notes

### [Run 123](https://example.com/123) - Jan 22 19:04
- Note 1`;

    const result = extractAgentNotesSection(body);
    expect(result).toContain("## Agent Notes");
    expect(result).toContain("[Run 123]");
    expect(result).not.toContain("## Description");
  });

  test("returns empty string if no Agent Notes section", () => {
    const body = `## Description

Some description.`;

    const result = extractAgentNotesSection(body);
    expect(result).toBe("");
  });
});

describe("AGENT_NOTES_SECTION constant", () => {
  test("has correct value", () => {
    expect(AGENT_NOTES_SECTION).toBe("## Agent Notes");
  });
});
