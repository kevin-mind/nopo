import { describe, it, expect } from "vitest";
import Pivot from "../../src/prompts/pivot.js";

const validInputs = {
  issueNumber: 42,
  issueTitle: "Add user authentication",
  pivotDescription: "Please also add password reset functionality",
  issueBody: "## Description\n\nWe need to add user authentication.",
  subIssuesJson: JSON.stringify([
    { number: 43, title: "[Phase 1]: Basic auth", state: "OPEN" },
    { number: 44, title: "[Phase 2]: OAuth", state: "OPEN" },
  ]),
  issueComments: "User: Can we also add MFA?",
};

describe("Pivot prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = Pivot(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains key strings", () => {
    const result = Pivot(validInputs);
    expect(result.prompt).toContain("#42");
    expect(result.prompt).toContain("Add user authentication");
    expect(result.prompt).toContain("password reset functionality");
    expect(result.prompt).toContain("Basic auth");
    expect(result.prompt).toContain("OAuth");
    expect(result.prompt).toContain("add MFA");
  });

  it("contains instruction sections as XML tags", () => {
    const result = Pivot(validInputs);
    expect(result.prompt).toContain('<section title="Pivot Request">');
    expect(result.prompt).toContain('<section title="Current State">');
    expect(result.prompt).toContain(
      '<section title="CRITICAL SAFETY CONSTRAINTS">',
    );
    expect(result.prompt).toContain('<section title="Your Task">');
    expect(result.prompt).toContain('<section title="Change Types">');
    expect(result.prompt).toContain('<section title="Output Format">');
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema matches expected structure", () => {
    const result = Pivot(validInputs);
    const schema = result.outputs as Record<string, unknown>;

    expect(schema.type).toBe("object");

    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("analysis");
    expect(properties).toHaveProperty("outcome");
    expect(properties).toHaveProperty("summary_for_user");

    const outcomeProp = properties.outcome as { type: string; enum: string[] };
    expect(outcomeProp.enum).toEqual([
      "changes_applied",
      "needs_clarification",
      "no_changes_needed",
    ]);

    const required = schema.required as string[];
    expect(required).toContain("analysis");
    expect(required).toContain("outcome");
    expect(required).toContain("summary_for_user");
  });

  it("throws on invalid inputs", () => {
    expect(() =>
      Pivot({ ...validInputs, issueNumber: "not a number" } as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema", () => {
    expect(Pivot.inputSchema).toBeDefined();
    expect(Pivot.outputSchema).toBeDefined();
    expect(Pivot.inputSchema.shape).toHaveProperty("issueNumber");
    expect(Pivot.inputSchema.shape).toHaveProperty("pivotDescription");
    expect(Pivot.outputSchema.shape).toHaveProperty("analysis");
    expect(Pivot.outputSchema.shape).toHaveProperty("outcome");
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = Pivot.renderTemplate();
      expect(template).toContain("{{ISSUE_NUMBER}}");
      expect(template).toContain("{{ISSUE_TITLE}}");
      expect(template).toContain("{{PIVOT_DESCRIPTION}}");
      expect(template).toContain("{{ISSUE_BODY}}");
      expect(template).toContain("{{SUB_ISSUES_JSON}}");
    });

    it("does not throw despite number schema fields", () => {
      expect(() => Pivot.renderTemplate()).not.toThrow();
    });
  });
});
