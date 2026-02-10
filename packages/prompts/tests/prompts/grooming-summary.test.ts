import { describe, it, expect } from "vitest";
import { z } from "zod";
import GroomingSummary from "../../src/prompts/grooming/summary.js";

const validInputs = {
  issueNumber: 42,
  issueTitle: "Add user authentication",
  issueBody: "## Description\n\nWe need to add user authentication.",
  issueComments: "Comment 1\n---\nComment 2",
  pmOutput: '{"ready": true}',
  engineerOutput: '{"ready": false, "questions": ["How should auth work?"]}',
  qaOutput: '{"ready": true}',
  researchOutput: '{"ready": true}',
};

describe("GroomingSummary prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = GroomingSummary(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains key strings", () => {
    const result = GroomingSummary(validInputs);
    expect(result.prompt).toContain("#42");
    expect(result.prompt).toContain("Add user authentication");
    expect(result.prompt).toContain("PM Analysis");
    expect(result.prompt).toContain("Engineer Analysis");
    expect(result.prompt).toContain("QA Analysis");
    expect(result.prompt).toContain("Research Findings");
  });

  it("contains instruction sections as XML tags", () => {
    const result = GroomingSummary(validInputs);
    expect(result.prompt).toContain('<section title="Your Task">');
    expect(result.prompt).toContain(
      '<section title="Question Consolidation Rules">',
    );
    expect(result.prompt).toContain('<section title="Decision Criteria">');
    expect(result.prompt).toContain('<section title="Output">');
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema matches expected structure", () => {
    const result = GroomingSummary(validInputs);
    const schema = result.outputs;
    if (!schema) throw new Error("expected outputs");

    expect(schema["type"]).toBe("object");

    const properties = z.record(z.unknown()).parse(schema["properties"]);
    expect(properties).toHaveProperty("summary");
    expect(properties).toHaveProperty("decision");
    expect(properties).toHaveProperty("decision_rationale");
    expect(properties).toHaveProperty("consolidated_questions");
    expect(properties).toHaveProperty("answered_questions");

    const required = z.array(z.string()).parse(schema["required"]);
    expect(required).toContain("summary");
    expect(required).toContain("decision");
    expect(required).toContain("decision_rationale");
  });

  it("throws on invalid inputs", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- testing runtime validation with intentionally invalid input
      GroomingSummary({ ...validInputs, issueNumber: "not a number" } as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema", () => {
    expect(GroomingSummary.inputSchema).toBeDefined();
    expect(GroomingSummary.outputSchema).toBeDefined();
    expect(GroomingSummary.inputSchema.shape).toHaveProperty("issueNumber");
    expect(GroomingSummary.inputSchema.shape).toHaveProperty(
      "previousQuestions",
    );
    expect(GroomingSummary.outputSchema.shape).toHaveProperty(
      "consolidated_questions",
    );
    expect(GroomingSummary.outputSchema.shape).toHaveProperty(
      "answered_questions",
    );
  });

  it("omits previous questions section when not provided", () => {
    const result = GroomingSummary(validInputs);
    expect(result.prompt).not.toContain(
      '<section title="Previous Grooming Questions">',
    );
    expect(result.prompt).not.toContain('<section title="Answer Tracking">');
  });

  it("includes previous questions section when provided", () => {
    const result = GroomingSummary({
      ...validInputs,
      previousQuestions:
        "- [ ] **Auth strategy** - Which auth method?\n- [ ] **DB schema** - What tables?",
    });
    expect(result.prompt).toContain(
      '<section title="Previous Grooming Questions">',
    );
    expect(result.prompt).toContain('<section title="Answer Tracking">');
    expect(result.prompt).toContain("Auth strategy");
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = GroomingSummary.renderTemplate();
      expect(template).toContain("{{ISSUE_NUMBER}}");
      expect(template).toContain("{{ISSUE_TITLE}}");
      expect(template).toContain("{{PM_OUTPUT}}");
      expect(template).toContain("{{ENGINEER_OUTPUT}}");
    });

    it("does not throw despite number schema fields", () => {
      expect(() => GroomingSummary.renderTemplate()).not.toThrow();
    });
  });
});
