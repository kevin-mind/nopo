import { describe, it, expect } from "vitest";
import { z } from "zod";
import Iterate from "../../src/prompts/iterate.js";

const validInputs = {
  issueNumber: 42,
  issueTitle: "Fix authentication flow",
  iteration: 3,
  lastCiResult: "failure",
  consecutiveFailures: 1,
  branchName: "claude/issue/42",
  prCreateCommand: 'gh pr create --title "Fix auth" --body "Fixes #42"',
  issueBody: "## Description\n\nFix the broken auth flow.",
  agentNotes: "Previous iteration found the bug in middleware.",
};

describe("Iterate prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = Iterate(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains key strings", () => {
    const result = Iterate(validInputs);
    expect(result.prompt).toContain("#42");
    expect(result.prompt).toContain("Fix authentication flow");
    expect(result.prompt).toContain("claude/issue/42");
    expect(result.prompt).toContain("Iteration");
    expect(result.prompt).toContain("failure");
    expect(result.prompt).toContain("Fix the broken auth flow");
    expect(result.prompt).toContain("middleware");
  });

  it("contains instruction sections as XML tags", () => {
    const result = Iterate(validInputs);
    expect(result.prompt).toContain('<section title="Instructions">');
    expect(result.prompt).toContain(
      '<section title="1. Assess Current State">',
    );
    expect(result.prompt).toContain('<section title="2. Determine Action">');
    expect(result.prompt).toContain('<section title="3. Implementation">');
    expect(result.prompt).toContain(
      '<section title="4. Fix and Verify Before Committing">',
    );
    expect(result.prompt).toContain('<section title="5. Commit and Push">');
    expect(result.prompt).toContain(
      '<section title="6. Create PR (First Iteration Only)">',
    );
    expect(result.prompt).toContain('<section title="Output">');
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema matches expected structure", () => {
    const result = Iterate(validInputs);
    const schema = result.outputs;
    if (!schema) throw new Error("expected outputs");

    expect(schema["type"]).toBe("object");

    const properties = z.record(z.unknown()).parse(schema["properties"]);
    expect(properties).toHaveProperty("status");
    expect(properties).toHaveProperty("todos_completed");
    expect(properties).toHaveProperty("manual_todo");
    expect(properties).toHaveProperty("blocked_reason");
    expect(properties).toHaveProperty("agent_notes");

    const statusProp = z
      .object({ type: z.string(), enum: z.array(z.string()) })
      .passthrough()
      .parse(properties["status"]);
    expect(statusProp.enum).toEqual([
      "completed_todo",
      "waiting_manual",
      "blocked",
      "all_done",
    ]);

    const required = z.array(z.string()).parse(schema["required"]);
    expect(required).toContain("status");
    expect(required).toContain("agent_notes");
  });

  it("throws on invalid inputs", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- testing runtime validation with intentionally invalid input
      Iterate({ ...validInputs, issueNumber: "not a number" } as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema", () => {
    expect(Iterate.inputSchema).toBeDefined();
    expect(Iterate.outputSchema).toBeDefined();
    expect(Iterate.inputSchema.shape).toHaveProperty("issueNumber");
    expect(Iterate.inputSchema.shape).toHaveProperty("issueTitle");
    expect(Iterate.outputSchema.shape).toHaveProperty("status");
    expect(Iterate.outputSchema.shape).toHaveProperty("agent_notes");
  });

  it("includes optional fields when provided", () => {
    const result = Iterate({
      ...validInputs,
      parentContext: "Parent issue #10 is about refactoring",
      existingBranchSection: "## Existing Branch\nThis branch has prior work.",
    });
    expect(result.prompt).toContain("Parent issue #10 is about refactoring");
    expect(result.prompt).toContain("This branch has prior work.");
  });

  it("omits optional sections when not provided", () => {
    const result = Iterate({
      ...validInputs,
      agentNotes: "",
    });
    // Agent notes section should not appear when empty
    expect(result.prompt).not.toContain(
      '<section title="Previous Agent Notes">',
    );
  });

  it("includes PR create command", () => {
    const result = Iterate(validInputs);
    expect(result.prompt).toContain(
      'gh pr create --title "Fix auth" --body "Fixes #42"',
    );
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = Iterate.renderTemplate();
      expect(template).toContain("{{ISSUE_NUMBER}}");
      expect(template).toContain("{{ISSUE_TITLE}}");
      expect(template).toContain("{{ITERATION}}");
      expect(template).toContain("{{BRANCH_NAME}}");
      expect(template).toContain("{{AGENT_NOTES}}");
      expect(template).toContain("{{ISSUE_BODY}}");
      expect(template).toContain("{{PR_CREATE_COMMAND}}");
    });

    it("still contains instruction sections as XML tags", () => {
      const template = Iterate.renderTemplate();
      expect(template).toContain('<section title="Instructions">');
      expect(template).toContain('<section title="1. Assess Current State">');
      expect(template).toContain('<section title="Output">');
    });

    it("does not throw despite number schema fields", () => {
      expect(() => Iterate.renderTemplate()).not.toThrow();
    });
  });
});
