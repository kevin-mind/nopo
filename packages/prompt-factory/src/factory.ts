import { z } from "zod";
import { toJsonSchema } from "./schema.js";
import type { PromptResult, PromptCallable } from "./types.js";

interface OutputsBuilder<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodObject<z.ZodRawShape>,
> {
  prompt(
    render: (inputs: z.infer<TInput>) => string,
  ): PromptCallable<TInput, TOutput>;
}

interface InputsBuilder<TInput extends z.ZodObject<z.ZodRawShape>> {
  outputs<OShape extends z.ZodRawShape>(
    fn: (zod: typeof z) => OShape,
  ): OutputsBuilder<TInput, z.ZodObject<OShape>>;
  prompt(
    render: (inputs: z.infer<TInput>) => string,
  ): PromptCallable<TInput, undefined>;
}

export function camelToScreamingSnake(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

function buildPlaceholderInputs(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, string> {
  const placeholders: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    placeholders[key] = `{{${camelToScreamingSnake(key)}}}`;
  }
  return placeholders;
}

function buildCallable<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodTypeAny | undefined,
>(
  inputSchema: TInput,
  outputSchema: TOutput,
  render: (inputs: z.infer<TInput>) => string,
): PromptCallable<TInput, TOutput> {
  const callable = (rawInputs: z.infer<TInput>): PromptResult => {
    const inputs = inputSchema.parse(rawInputs) as z.infer<TInput>;
    const prompt = render(inputs);
    return {
      prompt,
      outputs: outputSchema ? toJsonSchema(outputSchema) : undefined,
    };
  };
  callable.inputSchema = inputSchema;
  callable.outputSchema = outputSchema;
  callable.renderTemplate = () => {
    const placeholders = buildPlaceholderInputs(inputSchema);
    return render(placeholders as z.infer<TInput>);
  };
  return callable as PromptCallable<TInput, TOutput>;
}

export function promptFactory() {
  return {
    inputs<TShape extends z.ZodRawShape>(
      fn: (zod: typeof z) => TShape,
    ): InputsBuilder<z.ZodObject<TShape>> {
      const inputSchema = z.object(fn(z));
      return {
        outputs<OShape extends z.ZodRawShape>(
          fn: (zod: typeof z) => OShape,
        ): OutputsBuilder<z.ZodObject<TShape>, z.ZodObject<OShape>> {
          const outputSchema = z.object(fn(z));
          return {
            prompt(render) {
              return buildCallable(inputSchema, outputSchema, render);
            },
          };
        },
        prompt(render) {
          return buildCallable(inputSchema, undefined, render);
        },
      };
    },
  };
}
