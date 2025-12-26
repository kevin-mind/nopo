import { minimist } from "./lib.ts";

interface ParseTargetArgsOptions {
  leadingPositionals?: number; // For 'run': 1 (script name)
  boolean?: string[];
  string?: string[];
  alias?: Record<string, string | string[]>;
}

interface ParsedTargetArgs {
  targets: string[];
  leadingArgs: string[]; // e.g., ['test'] for run
  options: Record<string, unknown>;
}

/**
 * Parse command arguments to extract targets and options.
 *
 * @param commandName - The command name (e.g., 'build', 'up', 'run')
 * @param argv - The raw argv array (typically runner.argv.slice(1))
 * @param availableTargets - List of valid target names to validate against
 * @param opts - Options for parsing (minimist options + leadingPositionals)
 * @returns Parsed targets, leading args, and options
 */
export function parseTargetArgs(
  commandName: string,
  argv: string[],
  availableTargets: string[],
  opts: ParseTargetArgsOptions = {},
): ParsedTargetArgs {
  const { leadingPositionals = 0, ...minimistOpts } = opts;

  // Parse with minimist
  const parsed = minimist(argv, minimistOpts);

  // Extract leading positionals (e.g., script name for 'run')
  const leadingArgs: string[] = [];
  const positionalArgs: string[] = [];

  for (let i = 0; i < parsed._.length; i++) {
    const arg = parsed._[i];
    if (!arg) continue;
    if (i < leadingPositionals) {
      leadingArgs.push(arg);
    } else {
      positionalArgs.push(arg.toLowerCase());
    }
  }

  // Validate targets if any are provided
  if (positionalArgs.length > 0) {
    validateTargets(positionalArgs, availableTargets);
  }

  // Extract options (everything except _)
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== "_") {
      options[key] = value;
    }
  }

  return {
    targets: positionalArgs,
    leadingArgs,
    options,
  };
}

/**
 * Validate that all provided targets exist in the available targets list.
 *
 * @param targets - Target names to validate
 * @param availableTargets - List of valid target names
 * @throws Error if any target is unknown
 */
export function validateTargets(
  targets: string[],
  availableTargets: string[],
): void {
  const unknown = targets.filter((t) => !availableTargets.includes(t));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown target${unknown.length > 1 ? "s" : ""} '${unknown.join("', '")}'. ` +
        `Available targets: ${availableTargets.join(", ")}`,
    );
  }
}
