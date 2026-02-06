import { describe, it, expect } from "vitest";
import Review from "../../src/prompts/review.js";

const validInputs = {
  prNumber: 123,
  issueNumber: 42,
  headRef: "claude/issue/42",
  baseRef: "main",
  repoOwner: "kevin-mind",
  repoName: "nopo",
  agentNotes: "Previous review found test coverage issues.",
};

describe("Review prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = Review(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains key strings", () => {
    const result = Review(validInputs);
    expect(result.prompt).toContain("#123");
    expect(result.prompt).toContain("#42");
    expect(result.prompt).toContain("claude/issue/42");
    expect(result.prompt).toContain("main");
    expect(result.prompt).toContain("kevin-mind");
    expect(result.prompt).toContain("nopo");
    expect(result.prompt).toContain("test coverage issues");
  });

  it("contains instruction sections as XML tags", () => {
    const result = Review(validInputs);
    expect(result.prompt).toContain('<section title="Step 1: View Changes">');
    expect(result.prompt).toContain(
      '<section title="Step 2: Read ALL Existing Reviews and Comments">',
    );
    expect(result.prompt).toContain(
      '<section title="Step 3: Review the Code">',
    );
    expect(result.prompt).toContain(
      '<section title="Step 4: Make Your Decision">',
    );
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema matches expected structure", () => {
    const result = Review(validInputs);
    const schema = result.outputs as Record<string, unknown>;

    expect(schema.type).toBe("object");

    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("decision");
    expect(properties).toHaveProperty("body");

    const decisionProp = properties.decision as {
      type: string;
      enum: string[];
    };
    expect(decisionProp.enum).toEqual([
      "approve",
      "request_changes",
      "comment",
    ]);

    const required = schema.required as string[];
    expect(required).toContain("decision");
    expect(required).toContain("body");
  });

  it("throws on invalid inputs", () => {
    expect(() =>
      Review({ ...validInputs, prNumber: "not a number" } as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema", () => {
    expect(Review.inputSchema).toBeDefined();
    expect(Review.outputSchema).toBeDefined();
    expect(Review.inputSchema.shape).toHaveProperty("prNumber");
    expect(Review.inputSchema.shape).toHaveProperty("issueNumber");
    expect(Review.outputSchema.shape).toHaveProperty("decision");
    expect(Review.outputSchema.shape).toHaveProperty("body");
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = Review.renderTemplate();
      expect(template).toContain("{{PR_NUMBER}}");
      expect(template).toContain("{{ISSUE_NUMBER}}");
      expect(template).toContain("{{HEAD_REF}}");
      expect(template).toContain("{{BASE_REF}}");
    });

    it("does not throw despite number schema fields", () => {
      expect(() => Review.renderTemplate()).not.toThrow();
    });
  });
});
