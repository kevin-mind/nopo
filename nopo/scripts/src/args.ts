import { ScriptArgs } from "./script-args.ts";

/**
 * Base arguments available to all scripts
 * Scripts can extend these with their own specific arguments
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

  context: {
    type: "string",
    description: "Execution context: host or container",
    alias: ["c"],
    default: undefined,
    validate: (value) => {
      if (value && !["host", "container"].includes(value)) {
        throw new Error('--context must be "host" or "container"');
      }
    },
  },
});
