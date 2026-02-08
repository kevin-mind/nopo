import { z } from "zod";
import type { IssueStateData } from "./schemas/index.js";

/**
 * Create a type-safe extractor function
 *
 * @param schema - Zod schema for the output type
 * @param transform - Function that transforms IssueStateData to schema input
 * @returns Extractor function that validates output at runtime
 *
 * @example
 * const todosExtractor = createExtractor(TodoStatsSchema, (data) => {
 *   const ast = data.issue.bodyAst;
 *   // ... transform MDAST directly to TodoStats
 * });
 *
 * const todos = todosExtractor(issueState); // typed & validated
 */
export function createExtractor<T extends z.ZodType>(
  schema: T,
  transform: (data: IssueStateData) => z.input<T>,
): (data: IssueStateData) => z.output<T> {
  return (data: IssueStateData) => {
    const raw = transform(data);
    return schema.parse(raw);
  };
}
