import { z } from "zod";

/**
 * Base machine context schema
 *
 * Contains fields shared by all machine contexts (issue, discussion, etc.).
 * Domain-specific contexts extend this with their own fields.
 */
export const BaseMachineContextSchema = z.object({
  // Repository info
  owner: z.string().min(1),
  repo: z.string().min(1),

  // Config
  maxRetries: z.number().int().positive().default(5),
  botUsername: z.string().default("nopo-bot"),
});

type BaseMachineContext = z.infer<typeof BaseMachineContextSchema>;

/**
 * Default values for base context fields
 */
const BASE_CONTEXT_DEFAULTS = {
  maxRetries: 5,
  botUsername: "nopo-bot",
} as const;
