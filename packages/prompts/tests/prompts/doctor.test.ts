import { describe, it, expect } from "vitest";
import { z } from "zod";
import Doctor from "../../src/prompts/doctor.js";

const validInputs = {
  diagnosisFile: "/tmp/diagnosis-1234.json",
};

describe("Doctor prompt", () => {
  it("returns { prompt, outputs } when called with valid inputs", () => {
    const result = Doctor(validInputs);
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("outputs");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.outputs).toBe("object");
  });

  it("rendered prompt contains diagnosisFile path", () => {
    const result = Doctor(validInputs);
    expect(result.prompt).toContain("/tmp/diagnosis-1234.json");
  });

  it("contains instruction sections as XML tags", () => {
    const result = Doctor(validInputs);
    expect(result.prompt).toContain('<section title="Instructions">');
    expect(result.prompt).toContain('<section title="Output">');
    expect(result.prompt).toContain("</section>");
  });

  it("outputs JSON Schema has classification enum with 4 values", () => {
    const result = Doctor(validInputs);
    const schema = result.outputs;
    if (!schema) throw new Error("expected outputs");

    expect(schema["type"]).toBe("object");

    const properties = z.record(z.unknown()).parse(schema["properties"]);
    expect(properties).toHaveProperty("classification");

    const classificationProp = z
      .object({ type: z.string(), enum: z.array(z.string()) })
      .passthrough()
      .parse(properties["classification"]);
    expect(classificationProp.enum).toEqual([
      "false_negative",
      "true_bug",
      "race_condition",
      "unknown",
    ]);
  });

  it("outputs JSON Schema has required properties", () => {
    const result = Doctor(validInputs);
    const schema = result.outputs;
    if (!schema) throw new Error("expected outputs");

    const properties = z.record(z.unknown()).parse(schema["properties"]);
    expect(properties).toHaveProperty("classification");
    expect(properties).toHaveProperty("confidence");
    expect(properties).toHaveProperty("root_cause");
    expect(properties).toHaveProperty("fix_summary");
    expect(properties).toHaveProperty("affected_files");

    const confidenceProp = z
      .object({ type: z.string() })
      .passthrough()
      .parse(properties["confidence"]);
    expect(confidenceProp.type).toBe("number");

    const rootCauseProp = z
      .object({ type: z.string() })
      .passthrough()
      .parse(properties["root_cause"]);
    expect(rootCauseProp.type).toBe("string");

    const fixSummaryProp = z
      .object({ type: z.string() })
      .passthrough()
      .parse(properties["fix_summary"]);
    expect(fixSummaryProp.type).toBe("string");

    const affectedFilesProp = z
      .object({ type: z.string() })
      .passthrough()
      .parse(properties["affected_files"]);
    expect(affectedFilesProp.type).toBe("array");
  });

  it("throws when diagnosisFile is missing", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- testing runtime validation with intentionally invalid input
      Doctor({} as never),
    ).toThrow();
  });

  it("has .inputSchema and .outputSchema with expected shape properties", () => {
    expect(Doctor.inputSchema).toBeDefined();
    expect(Doctor.outputSchema).toBeDefined();
    expect(Doctor.inputSchema.shape).toHaveProperty("diagnosisFile");
    expect(Doctor.outputSchema.shape).toHaveProperty("classification");
    expect(Doctor.outputSchema.shape).toHaveProperty("confidence");
    expect(Doctor.outputSchema.shape).toHaveProperty("root_cause");
    expect(Doctor.outputSchema.shape).toHaveProperty("fix_summary");
    expect(Doctor.outputSchema.shape).toHaveProperty("affected_files");
  });

  describe("renderTemplate", () => {
    it("renders with placeholder variables", () => {
      const template = Doctor.renderTemplate();
      expect(template).toContain("{{DIAGNOSIS_FILE}}");
    });

    it("does not throw despite string schema fields", () => {
      expect(() => Doctor.renderTemplate()).not.toThrow();
    });
  });
});
