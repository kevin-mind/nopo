import { describe, it, expect } from "vitest";
import Triage from "../../src/prompts/triage.js";

const validInputs = {
  issueNumber: 42,
  issueTitle: "Add user authentication",
  issueBody: "## Description\n\nWe need to add user authentication to the app.",
  agentNotes: "Related to #10 for security improvements.",
};

describe("Triage prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = Triage(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains key strings", () => {
    const result = Triage(validInputs);
    expect(result.prompt).toContain("#42");
    expect(result.prompt).toContain("Add user authentication");
    expect(result.prompt).toContain("add user authentication to the app");
    expect(result.prompt).toContain("Related to #10");
  });

  it("contains instruction sections as XML tags", () => {
    const result = Triage(validInputs);
    expect(result.prompt).toContain('<section title="Your Task">');
    expect(result.prompt).toContain('<section title="1. Classification">');
    expect(result.prompt).toContain(
      '<section title="2. Extract Requirements">',
    );
    expect(result.prompt).toContain('<section title="3. Initial Approach">');
    expect(result.prompt).toContain('<section title="Output">');
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema matches expected structure", () => {
    const result = Triage(validInputs);
    const schema = result.outputs as Record<string, unknown>;

    expect(schema.type).toBe("object");

    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("triage");
    expect(properties).toHaveProperty("requirements");
    expect(properties).toHaveProperty("initial_approach");

    const required = schema.required as string[];
    expect(required).toContain("triage");
    expect(required).toContain("requirements");
    expect(required).toContain("initial_approach");
  });

  it("throws on invalid inputs", () => {
    expect(() =>
      Triage({ ...validInputs, issueNumber: "not a number" } as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema", () => {
    expect(Triage.inputSchema).toBeDefined();
    expect(Triage.outputSchema).toBeDefined();
    expect(Triage.inputSchema.shape).toHaveProperty("issueNumber");
    expect(Triage.inputSchema.shape).toHaveProperty("issueTitle");
    expect(Triage.outputSchema.shape).toHaveProperty("triage");
    expect(Triage.outputSchema.shape).toHaveProperty("requirements");
  });

  it("omits agent notes section when not provided", () => {
    const result = Triage({
      ...validInputs,
      agentNotes: undefined,
    });
    expect(result.prompt).not.toContain(
      '<section title="Previous Agent Notes">',
    );
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = Triage.renderTemplate();
      expect(template).toContain("{{ISSUE_NUMBER}}");
      expect(template).toContain("{{ISSUE_TITLE}}");
      expect(template).toContain("{{ISSUE_BODY}}");
    });

    it("does not throw despite number schema fields", () => {
      expect(() => Triage.renderTemplate()).not.toThrow();
    });
  });
});
