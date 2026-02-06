import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

const cache = new WeakMap<z.ZodTypeAny, Record<string, unknown>>();

export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  let result = cache.get(schema);
  if (!result) {
    const raw = zodToJsonSchema(schema) as Record<string, unknown>;
    delete raw.$schema;
    result = raw;
    cache.set(schema, result);
  }
  return result;
}
