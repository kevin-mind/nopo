import type { z } from "zod";

export interface PromptResult {
  prompt: string;
  outputs?: Record<string, unknown>;
}

export type PromptCallable<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny | undefined,
> = ((inputs: z.infer<TInput>) => PromptResult) & {
  inputSchema: TInput;
  outputSchema: TOutput;
  renderTemplate: () => string;
};
