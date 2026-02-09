import { describe, it, expect } from "vitest";
import { z } from "zod";
import Comment from "../../src/prompts/comment.js";

const validInputs = {
  contextType: "issue" as const,
  contextDescription: "User asked: How do I fix the login bug?",
  agentNotes: "Previous analysis found the issue in auth middleware.",
};

describe("Comment prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = Comment(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains key strings", () => {
    const result = Comment(validInputs);
    expect(result.prompt).toContain("issue");
    expect(result.prompt).toContain("How do I fix the login bug?");
    expect(result.prompt).toContain("auth middleware");
  });

  it("contains instruction sections as XML tags", () => {
    const result = Comment(validInputs);
    expect(result.prompt).toContain('<section title="Your Task">');
    expect(result.prompt).toContain('<section title="Action Detection">');
    expect(result.prompt).toContain('<section title="Output">');
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema matches expected structure", () => {
    const result = Comment(validInputs);
    const schema = result.outputs;
    if (!schema) throw new Error("expected outputs");

    expect(schema["type"]).toBe("object");

    const properties = z.record(z.unknown()).parse(schema["properties"]);
    expect(properties).toHaveProperty("action_type");
    expect(properties).toHaveProperty("response_body");
    expect(properties).toHaveProperty("commits");

    const actionTypeProp = z
      .object({ type: z.string(), enum: z.array(z.string()) })
      .passthrough()
      .parse(properties["action_type"]);
    expect(actionTypeProp.enum).toEqual(["response", "implementation"]);

    const required = z.array(z.string()).parse(schema["required"]);
    expect(required).toContain("action_type");
    expect(required).toContain("response_body");
  });

  it("throws on invalid inputs", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- testing runtime validation with intentionally invalid input
      Comment({ ...validInputs, contextType: "invalid" } as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema", () => {
    expect(Comment.inputSchema).toBeDefined();
    expect(Comment.outputSchema).toBeDefined();
    expect(Comment.inputSchema.shape).toHaveProperty("contextType");
    expect(Comment.inputSchema.shape).toHaveProperty("contextDescription");
    expect(Comment.outputSchema.shape).toHaveProperty("action_type");
    expect(Comment.outputSchema.shape).toHaveProperty("response_body");
  });

  it("works with pr context type", () => {
    const result = Comment({
      ...validInputs,
      contextType: "pr",
    });
    expect(result.prompt).toContain("pr");
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = Comment.renderTemplate();
      expect(template).toContain("{{CONTEXT_TYPE}}");
      expect(template).toContain("{{CONTEXT_DESCRIPTION}}");
    });

    it("does not throw despite enum schema fields", () => {
      expect(() => Comment.renderTemplate()).not.toThrow();
    });
  });
});
