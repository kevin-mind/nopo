import { describe, it, expect } from "vitest";
import {
  getSection,
  removeSection,
  upsertSection,
  upsertSections,
  hasSection,
  formatRequirements,
  formatQuestions,
  formatRelated,
  STANDARD_SECTION_ORDER,
} from "../../parser/section-parser.js";

describe("section-parser", () => {
  describe("getSection", () => {
    it("extracts content from a named section", () => {
      const body = `# Title

## Description

This is the description.

## Approach

High-level approach here.

## Testing

Test cases here.
`;
      expect(getSection(body, "Description")).toBe("This is the description.");
      expect(getSection(body, "Approach")).toBe("High-level approach here.");
      expect(getSection(body, "Testing")).toBe("Test cases here.");
    });

    it("returns null for non-existent section", () => {
      const body = `## Description\n\nSome content.`;
      expect(getSection(body, "Questions")).toBeNull();
    });

    it("handles case-insensitive section names", () => {
      const body = `## DESCRIPTION\n\nUpper case content.`;
      expect(getSection(body, "description")).toBe("Upper case content.");
    });

    it("handles section with content spanning to another section", () => {
      // When sections are consecutive, the content includes everything between them
      const body = `## Description\n\nSome content here.\n\n## Approach\n\nSome approach.`;
      expect(getSection(body, "Description")).toBe("Some content here.");
    });
  });

  describe("removeSection", () => {
    it("removes a named section", () => {
      const body = `## Description\n\nSome content.\n\n## Approach\n\nApproach content.`;
      const result = removeSection(body, "Description");
      expect(result).not.toContain("Description");
      expect(result).toContain("Approach");
      expect(result).toContain("Approach content");
    });

    it("returns body unchanged if section not found", () => {
      const body = `## Description\n\nSome content.`;
      const result = removeSection(body, "NonExistent");
      expect(result).toBe(body);
    });
  });

  describe("hasSection", () => {
    it("returns true for existing sections", () => {
      const body = `## Description\n\nContent.`;
      expect(hasSection(body, "Description")).toBe(true);
    });

    it("returns false for missing sections", () => {
      const body = `## Description\n\nContent.`;
      expect(hasSection(body, "Approach")).toBe(false);
    });
  });

  describe("upsertSection", () => {
    it("adds a new section when it does not exist", () => {
      const body = `## Description\n\nSome content.`;
      const result = upsertSection(body, "Approach", "New approach content");
      expect(result).toContain("## Approach");
      expect(result).toContain("New approach content");
    });

    it("updates an existing section", () => {
      const body = `## Description\n\nOld content.\n\n## Approach\n\nOld approach.`;
      const result = upsertSection(body, "Description", "New content");
      expect(result).toContain("New content");
      expect(result).not.toContain("Old content");
      expect(result).toContain("Old approach"); // Other section unchanged
    });

    it("respects section order when inserting", () => {
      const body = `## Description\n\nSome content.\n\n## Testing\n\nTests.`;
      const result = upsertSection(body, "Approach", "Approach content", {
        sectionOrder: ["Description", "Approach", "Testing"],
      });
      // Approach should appear between Description and Testing
      const approachIndex = result.indexOf("## Approach");
      const testingIndex = result.indexOf("## Testing");
      expect(approachIndex).toBeLessThan(testingIndex);
    });

    it("inserts before Agent Notes section", () => {
      const body = `## Description\n\nSome content.\n\n## Agent Notes\n\nNotes here.`;
      const result = upsertSection(body, "Approach", "New approach");
      const approachIndex = result.indexOf("## Approach");
      const notesIndex = result.indexOf("## Agent Notes");
      expect(approachIndex).toBeLessThan(notesIndex);
    });
  });

  describe("upsertSections", () => {
    it("updates multiple sections at once", () => {
      const body = `## Description\n\nOld description.`;
      const sections = [
        { name: "Requirements", content: "- Req 1\n- Req 2" },
        { name: "Approach", content: "The approach" },
      ];
      const result = upsertSections(body, sections, STANDARD_SECTION_ORDER);
      expect(result).toContain("## Requirements");
      expect(result).toContain("- Req 1");
      expect(result).toContain("## Approach");
      expect(result).toContain("The approach");
    });
  });

  describe("formatRequirements", () => {
    it("formats requirements as markdown list", () => {
      const requirements = ["First requirement", "Second requirement"];
      const result = formatRequirements(requirements);
      expect(result).toBe("- First requirement\n- Second requirement");
    });

    it("returns placeholder for empty requirements", () => {
      const result = formatRequirements([]);
      expect(result).toContain("No specific requirements");
    });
  });

  describe("formatQuestions", () => {
    it("formats unanswered questions as unchecked checkboxes", () => {
      const questions = [
        { question: "What is the scope?" },
        { question: "Who will test?" },
      ];
      const result = formatQuestions(questions);
      expect(result).toContain("- [ ] What is the scope?");
      expect(result).toContain("- [ ] Who will test?");
    });

    it("formats answered questions as checked with answer", () => {
      const questions = [
        { question: "What is the scope?", answer: "Frontend only" },
      ];
      const result = formatQuestions(questions);
      expect(result).toContain("- [x] What is the scope?: Frontend only");
    });

    it("returns placeholder for empty questions", () => {
      const result = formatQuestions([]);
      expect(result).toContain("No questions");
    });
  });

  describe("formatRelated", () => {
    it("formats related items as markdown list with issue links", () => {
      const items = [
        { number: 123, description: "Related feature" },
        { number: 456 },
      ];
      const result = formatRelated(items);
      expect(result).toContain("- #123 - Related feature");
      expect(result).toContain("- #456");
    });

    it("returns placeholder for empty items", () => {
      const result = formatRelated([]);
      expect(result).toContain("No related items");
    });
  });
});
