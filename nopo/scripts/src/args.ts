import { ScriptArgs } from "./script-args.ts";

/**
 * Base arguments available to all scripts
 * Scripts can extend these with their own specific arguments
 *
 * Note: Not all args belong here. Only truly global args like filter/since.
 * Command-specific args (like context for CommandScript) should be defined
 * in the individual script files.
 */
export const baseArgs = new ScriptArgs({
  filter: {
    type: "string",
    description: 'Filter targets by expression (e.g., "buildable", "changed")',
    alias: ["f"],
    default: undefined,
  },

  since: {
    type: "string",
    description: "Filter changed files since git ref",
    alias: ["s"],
    default: undefined,
  },

  tags: {
    type: "string",
    description: "Filter targets by tags (comma-separated, match any)",
    default: undefined,
  },
});
