import { describe, it, expect } from "vitest";
import ReviewResponse from "../../src/prompts/review-response.js";

const validInputs = {
  prNumber: 123,
  reviewer: "reviewer-user",
  reviewDecision: "CHANGES_REQUESTED",
  headRef: "claude/issue/42",
  repoOwner: "kevin-mind",
  repoName: "nopo",
  agentNotes: "Previous iteration added tests.",
};

describe("ReviewResponse prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = ReviewResponse(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains key strings", () => {
    const result = ReviewResponse(validInputs);
    expect(result.prompt).toContain("#123");
    expect(result.prompt).toContain("@reviewer-user");
    expect(result.prompt).toContain("CHANGES_REQUESTED");
    expect(result.prompt).toContain("claude/issue/42");
    expect(result.prompt).toContain("kevin-mind");
    expect(result.prompt).toContain("nopo");
    expect(result.prompt).toContain("added tests");
  });

  it("contains instruction sections as XML tags", () => {
    const result = ReviewResponse(validInputs);
    expect(result.prompt).toContain(
      '<section title="Step 1: Read ALL Reviews and Comments">',
    );
    expect(result.prompt).toContain(
      '<section title="Step 2: Process Feedback">',
    );
    expect(result.prompt).toContain(
      '<section title="Step 3: Commit and Push (if changes made)">',
    );
    expect(result.prompt).toContain('<section title="Rules">');
    expect(result.prompt).toContain('<section title="Output">');
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema matches expected structure", () => {
    const result = ReviewResponse(validInputs);
    const schema = result.outputs as Record<string, unknown>;

    expect(schema.type).toBe("object");

    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("had_commits");
    expect(properties).toHaveProperty("summary");
    expect(properties).toHaveProperty("commits");

    const required = schema.required as string[];
    expect(required).toContain("had_commits");
    expect(required).toContain("summary");
  });

  it("throws on invalid inputs", () => {
    expect(() =>
      ReviewResponse({ ...validInputs, prNumber: "not a number" } as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema", () => {
    expect(ReviewResponse.inputSchema).toBeDefined();
    expect(ReviewResponse.outputSchema).toBeDefined();
    expect(ReviewResponse.inputSchema.shape).toHaveProperty("prNumber");
    expect(ReviewResponse.inputSchema.shape).toHaveProperty("reviewer");
    expect(ReviewResponse.outputSchema.shape).toHaveProperty("had_commits");
    expect(ReviewResponse.outputSchema.shape).toHaveProperty("summary");
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = ReviewResponse.renderTemplate();
      expect(template).toContain("{{PR_NUMBER}}");
      expect(template).toContain("{{REVIEWER}}");
      expect(template).toContain("{{REVIEW_DECISION}}");
      expect(template).toContain("{{HEAD_REF}}");
    });

    it("does not throw despite number schema fields", () => {
      expect(() => ReviewResponse.renderTemplate()).not.toThrow();
    });
  });
});
