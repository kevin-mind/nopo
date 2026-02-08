import { z } from "zod";
import type { IssueStateData } from "./schemas/index.js";

/**
 * Create a type-safe mutator function
 *
 * @param inputSchema - Zod schema for the mutation input
 * @param mutate - Function that applies the mutation to IssueStateData
 * @returns Mutator function that validates input and returns modified state
 *
 * @example
 * // In statemachine
 * const checkOffTodo = createMutator(
 *   z.object({ todoText: z.string() }),
 *   (input, data) => {
 *     // Clone and mutate MDAST
 *     const newAst = structuredClone(data.issue.bodyAst);
 *     // Find and check off todo...
 *     return { ...data, issue: { ...data.issue, bodyAst: newAst } };
 *   }
 * );
 *
 * // Usage
 * const newState = checkOffTodo({ todoText: "Fix bug" }, issueState);
 */
export function createMutator<TInput extends z.ZodType>(
  inputSchema: TInput,
  mutate: (input: z.output<TInput>, data: IssueStateData) => IssueStateData,
): (input: z.input<TInput>, data: IssueStateData) => IssueStateData {
  return (input, data) => {
    const validated = inputSchema.parse(input);
    return mutate(validated, data);
  };
}
