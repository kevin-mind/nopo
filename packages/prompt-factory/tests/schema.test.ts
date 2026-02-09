import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../src/schema.js";

describe("toJsonSchema", () => {
  it("converts basic Zod schema to JSON Schema", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = toJsonSchema(schema);
    expect(result.type).toBe("object");
    const props = z
      .record(z.object({ type: z.string() }).passthrough())
      .parse(result.properties);
    expect(props).toHaveProperty("name");
    expect(props).toHaveProperty("age");
    expect(props["name"]?.type).toBe("string");
    expect(props["age"]?.type).toBe("number");
  });

  it("strips $schema key", () => {
    const schema = z.object({ x: z.string() });
    const result = toJsonSchema(schema);
    expect(result).not.toHaveProperty("$schema");
  });

  it("handles enums", () => {
    const schema = z.object({
      status: z.enum(["active", "inactive", "pending"]),
    });
    const result = toJsonSchema(schema);
    const props = z
      .record(z.object({ enum: z.array(z.string()) }).passthrough())
      .parse(result.properties);
    expect(props["status"]?.enum).toEqual(["active", "inactive", "pending"]);
  });

  it("handles arrays", () => {
    const schema = z.object({
      items: z.array(z.string()),
    });
    const result = toJsonSchema(schema);
    const props = z
      .record(
        z
          .object({
            type: z.string(),
            items: z.object({ type: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .parse(result.properties);
    expect(props["items"]?.type).toBe("array");
    expect(props["items"]?.items.type).toBe("string");
  });

  it("handles nested objects", () => {
    const schema = z.object({
      nested: z.object({
        value: z.number(),
      }),
    });
    const result = toJsonSchema(schema);
    const props = z
      .record(
        z
          .object({
            type: z.string(),
            properties: z.record(z.object({ type: z.string() }).passthrough()),
          })
          .passthrough(),
      )
      .parse(result.properties);
    expect(props["nested"]?.type).toBe("object");
    expect(props["nested"]?.properties["value"]?.type).toBe("number");
  });

  it("handles optional fields", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });
    const result = toJsonSchema(schema);
    const required = z.array(z.string()).parse(result.required);
    expect(required).toContain("required");
    expect(required).not.toContain("optional");
  });

  it("caches: same schema returns same object", () => {
    const schema = z.object({ x: z.string() });
    const first = toJsonSchema(schema);
    const second = toJsonSchema(schema);
    expect(first).toBe(second);
  });
});
