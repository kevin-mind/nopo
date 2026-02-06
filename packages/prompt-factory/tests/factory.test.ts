import { describe, it, expect } from "vitest";
import { promptFactory, camelToScreamingSnake } from "../src/factory.js";

describe("factory", () => {
  it("full chain .inputs().outputs().prompt() returns callable", () => {
    const MyPrompt = promptFactory()
      .inputs((z) => ({
        name: z.string(),
      }))
      .outputs((z) => ({
        result: z.string(),
      }))
      .prompt((inputs) => `Hello, ${inputs.name}`);

    expect(typeof MyPrompt).toBe("function");
  });

  it("callable returns { prompt, outputs } with correct values", () => {
    const MyPrompt = promptFactory()
      .inputs((z) => ({
        name: z.string(),
        count: z.number(),
      }))
      .outputs((z) => ({
        status: z.enum(["ok", "error"]),
      }))
      .prompt((inputs) => `${inputs.name}: ${inputs.count}`);

    const result = MyPrompt({ name: "test", count: 5 });
    expect(result.prompt).toBe("test: 5");
    expect(result.outputs).toBeDefined();
    expect(result.outputs).toHaveProperty("type", "object");
    expect(result.outputs).toHaveProperty("properties");
  });

  it("validates inputs and throws on invalid data", () => {
    const MyPrompt = promptFactory()
      .inputs((z) => ({
        name: z.string(),
        age: z.number(),
      }))
      .outputs((z) => ({
        ok: z.boolean(),
      }))
      .prompt((inputs) => `${inputs.name} is ${inputs.age}`);

    expect(() =>
      MyPrompt({ name: "test", age: "not a number" as unknown as number }),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema on callable", () => {
    const MyPrompt = promptFactory()
      .inputs((z) => ({
        x: z.number(),
      }))
      .outputs((z) => ({
        y: z.string(),
      }))
      .prompt((inputs) => String(inputs.x));

    expect(MyPrompt.inputSchema).toBeDefined();
    expect(MyPrompt.outputSchema).toBeDefined();
    expect(MyPrompt.inputSchema.shape).toHaveProperty("x");
    expect(MyPrompt.outputSchema.shape).toHaveProperty("y");
  });

  it("chain without .outputs() works (outputs is undefined)", () => {
    const MyPrompt = promptFactory()
      .inputs((z) => ({
        msg: z.string(),
      }))
      .prompt((inputs) => inputs.msg);

    const result = MyPrompt({ msg: "hello" });
    expect(result.prompt).toBe("hello");
    expect(result.outputs).toBeUndefined();
    expect(MyPrompt.outputSchema).toBeUndefined();
  });

  it("JSX renders to string in prompt callback", () => {
    const MyPrompt = promptFactory()
      .inputs((z) => ({
        title: z.string(),
      }))
      .outputs((z) => ({
        ok: z.boolean(),
      }))
      .prompt((inputs) => `# ${inputs.title}\n\nBody text`);

    const result = MyPrompt({ title: "Test" });
    expect(result.prompt).toBe("# Test\n\nBody text");
  });

  describe("renderTemplate", () => {
    it("renders with {{SCREAMING_SNAKE}} placeholders", () => {
      const MyPrompt = promptFactory()
        .inputs((z) => ({
          issueNumber: z.number(),
          issueTitle: z.string(),
          iteration: z.number(),
        }))
        .outputs((z) => ({
          status: z.string(),
        }))
        .prompt(
          (inputs) =>
            `Issue #${inputs.issueNumber}: "${inputs.issueTitle}" (iteration ${inputs.iteration})`,
        );

      const template = MyPrompt.renderTemplate();
      expect(template).toBe(
        'Issue #{{ISSUE_NUMBER}}: "{{ISSUE_TITLE}}" (iteration {{ITERATION}})',
      );
    });

    it("skips Zod validation (string placeholders for number fields)", () => {
      const MyPrompt = promptFactory()
        .inputs((z) => ({
          count: z.number(),
          name: z.string(),
        }))
        .outputs((z) => ({
          ok: z.boolean(),
        }))
        .prompt((inputs) => `${inputs.name}: ${inputs.count}`);

      // Should not throw even though count expects a number
      expect(() => MyPrompt.renderTemplate()).not.toThrow();
      expect(MyPrompt.renderTemplate()).toBe("{{NAME}}: {{COUNT}}");
    });

    it("works without outputs", () => {
      const MyPrompt = promptFactory()
        .inputs((z) => ({
          msg: z.string(),
        }))
        .prompt((inputs) => inputs.msg);

      expect(MyPrompt.renderTemplate()).toBe("{{MSG}}");
    });
  });

  describe("camelToScreamingSnake", () => {
    it("converts camelCase to SCREAMING_SNAKE_CASE", () => {
      expect(camelToScreamingSnake("issueNumber")).toBe("ISSUE_NUMBER");
      expect(camelToScreamingSnake("issueTitle")).toBe("ISSUE_TITLE");
      expect(camelToScreamingSnake("iteration")).toBe("ITERATION");
      expect(camelToScreamingSnake("lastCiResult")).toBe("LAST_CI_RESULT");
      expect(camelToScreamingSnake("consecutiveFailures")).toBe(
        "CONSECUTIVE_FAILURES",
      );
      expect(camelToScreamingSnake("branchName")).toBe("BRANCH_NAME");
      expect(camelToScreamingSnake("prCreateCommand")).toBe(
        "PR_CREATE_COMMAND",
      );
      expect(camelToScreamingSnake("agentNotes")).toBe("AGENT_NOTES");
    });

    it("handles single word", () => {
      expect(camelToScreamingSnake("name")).toBe("NAME");
    });

    it("handles already uppercase acronyms", () => {
      expect(camelToScreamingSnake("lastCIResult")).toBe("LAST_CI_RESULT");
      expect(camelToScreamingSnake("parseHTML")).toBe("PARSE_HTML");
    });
  });

  it("output schema matches expected JSON Schema structure", () => {
    const MyPrompt = promptFactory()
      .inputs((z) => ({
        x: z.number(),
      }))
      .outputs((z) => ({
        status: z.enum(["a", "b"]),
        items: z.array(z.string()),
        note: z.string().optional(),
      }))
      .prompt(() => "test");

    const result = MyPrompt({ x: 1 });
    const schema = result.outputs as Record<string, unknown>;
    expect(schema).not.toHaveProperty("$schema");
    expect(schema.type).toBe("object");

    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("status");
    expect(properties).toHaveProperty("items");
    expect(properties).toHaveProperty("note");
  });
});
