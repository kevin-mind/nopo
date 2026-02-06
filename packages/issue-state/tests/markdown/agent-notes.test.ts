import { describe, it, expect } from "vitest";
import {
  parseAgentNotes,
  appendAgentNotes,
  removeAgentNotesSection,
  extractAgentNotesSection,
} from "../../src/markdown/agent-notes.js";

const BODY_WITH_NOTES = `## Description

Some text

## Agent Notes

### [Run 12345678901](https://github.com/o/r/actions/runs/12345678901) - Jan 22 19:04
- Found a bug in auth module
- Needs refactoring of login flow

### [Run 12345678900](https://github.com/o/r/actions/runs/12345678900) - Jan 21 10:00
- Initial analysis complete`;

describe("parseAgentNotes", () => {
  it("parses agent notes entries", () => {
    const entries = parseAgentNotes(BODY_WITH_NOTES);
    expect(entries).toHaveLength(2);

    expect(entries[0]!.runId).toBe("12345678901");
    expect(entries[0]!.runLink).toBe("https://github.com/o/r/actions/runs/12345678901");
    expect(entries[0]!.timestamp).toBe("Jan 22 19:04");
    expect(entries[0]!.notes).toEqual([
      "Found a bug in auth module",
      "Needs refactoring of login flow",
    ]);

    expect(entries[1]!.runId).toBe("12345678900");
    expect(entries[1]!.notes).toEqual(["Initial analysis complete"]);
  });

  it("returns empty for body without agent notes", () => {
    expect(parseAgentNotes("No notes")).toEqual([]);
  });
});

describe("appendAgentNotes", () => {
  it("appends to existing section", () => {
    const result = appendAgentNotes(BODY_WITH_NOTES, {
      runId: "99999",
      runLink: "https://github.com/o/r/actions/runs/99999",
      notes: ["New note"],
    });
    const entries = parseAgentNotes(result);
    // New entry prepended
    expect(entries[0]!.runId).toBe("99999");
    expect(entries[0]!.notes).toEqual(["New note"]);
  });

  it("creates section when missing", () => {
    const result = appendAgentNotes("Just description", {
      runId: "99999",
      runLink: "https://github.com/o/r/actions/runs/99999",
      notes: ["New note"],
    });
    expect(result).toContain("## Agent Notes");
    expect(result).toContain("New note");
  });

  it("skips if no notes", () => {
    const body = "Original body";
    const result = appendAgentNotes(body, {
      runId: "99999",
      runLink: "https://example.com",
      notes: [],
    });
    expect(result).toBe(body);
  });
});

describe("removeAgentNotesSection", () => {
  it("removes agent notes section", () => {
    const result = removeAgentNotesSection(BODY_WITH_NOTES);
    expect(result).not.toContain("## Agent Notes");
    expect(result).toContain("## Description");
  });
});

describe("extractAgentNotesSection", () => {
  it("extracts the section", () => {
    const result = extractAgentNotesSection(BODY_WITH_NOTES);
    expect(result).toContain("## Agent Notes");
    expect(result).toContain("Run 12345678901");
  });

  it("returns empty string if no section", () => {
    expect(extractAgentNotesSection("No notes")).toBe("");
  });
});
