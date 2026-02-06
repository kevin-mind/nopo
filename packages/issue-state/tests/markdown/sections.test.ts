import { describe, it, expect } from "vitest";
import {
  getSection,
  removeSection,
  upsertSection,
  upsertSections,
  hasSection,
  extractAllSections,
  getDescription,
  STANDARD_SECTION_ORDER,
} from "../../src/markdown/sections.js";

const SAMPLE_BODY = `This is the description.

## Requirements

- Req 1
- Req 2

## Approach

Use TDD.

## Todo

- [ ] Do thing 1
- [x] Do thing 2`;

describe("getSection", () => {
  it("returns section content", () => {
    expect(getSection(SAMPLE_BODY, "Requirements")).toBe("- Req 1\n- Req 2");
  });

  it("returns null for missing section", () => {
    expect(getSection(SAMPLE_BODY, "Nonexistent")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(getSection(SAMPLE_BODY, "requirements")).toBe("- Req 1\n- Req 2");
  });
});

describe("hasSection", () => {
  it("returns true for existing section", () => {
    expect(hasSection(SAMPLE_BODY, "Approach")).toBe(true);
  });

  it("returns false for missing section", () => {
    expect(hasSection(SAMPLE_BODY, "Missing")).toBe(false);
  });
});

describe("removeSection", () => {
  it("removes an existing section", () => {
    const result = removeSection(SAMPLE_BODY, "Approach");
    expect(result).not.toContain("## Approach");
    expect(result).not.toContain("Use TDD.");
    expect(result).toContain("## Requirements");
    expect(result).toContain("## Todo");
  });

  it("returns body unchanged if section not found", () => {
    const result = removeSection(SAMPLE_BODY, "Nonexistent");
    expect(result).toBe(SAMPLE_BODY.trim());
  });
});

describe("upsertSection", () => {
  it("updates existing section content", () => {
    const result = upsertSection(SAMPLE_BODY, "Approach", "Use BDD instead.");
    expect(getSection(result, "Approach")).toBe("Use BDD instead.");
  });

  it("inserts new section at end", () => {
    const result = upsertSection(SAMPLE_BODY, "Notes", "Some notes.");
    expect(hasSection(result, "Notes")).toBe(true);
    expect(getSection(result, "Notes")).toBe("Some notes.");
  });

  it("respects sectionOrder for insertion", () => {
    const result = upsertSection(
      SAMPLE_BODY,
      "Testing",
      "Run tests.",
      { sectionOrder: STANDARD_SECTION_ORDER },
    );
    expect(hasSection(result, "Testing")).toBe(true);
    // Testing should come before Todo in the standard order
    const testingIdx = result.indexOf("## Testing");
    const todoIdx = result.indexOf("## Todo");
    expect(testingIdx).toBeLessThan(todoIdx);
  });
});

describe("upsertSections", () => {
  it("updates multiple sections at once", () => {
    const result = upsertSections(SAMPLE_BODY, [
      { name: "Requirements", content: "Updated reqs." },
      { name: "Approach", content: "Updated approach." },
    ]);
    expect(getSection(result, "Requirements")).toBe("Updated reqs.");
    expect(getSection(result, "Approach")).toBe("Updated approach.");
  });
});

describe("extractAllSections", () => {
  it("extracts all sections from body", () => {
    const sections = extractAllSections(SAMPLE_BODY);
    expect(sections).toHaveLength(3);
    expect(sections[0]!.name).toBe("Requirements");
    expect(sections[1]!.name).toBe("Approach");
    expect(sections[2]!.name).toBe("Todo");
  });
});

describe("getDescription", () => {
  it("returns text before first section", () => {
    expect(getDescription(SAMPLE_BODY)).toBe("This is the description.");
  });

  it("returns full body if no sections", () => {
    expect(getDescription("Just a description.")).toBe("Just a description.");
  });

  it("returns null for empty body", () => {
    expect(getDescription("")).toBeNull();
  });
});
