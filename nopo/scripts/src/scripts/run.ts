import path from "node:path";
import compose from "docker-compose";

import EnvScript from "./env.ts";
import BuildScript from "./build.ts";
import PullScript from "./pull.ts";
import { isBuild, isPull } from "./up.ts";

import {
  TargetScript,
  type ScriptDependency,
  type Runner,
  createLogger,
  minimist,
} from "../lib.ts";
import {
  resolveCommand,
  validateCommandTargets,
  type ResolvedCommand,
} from "../commands/index.ts";
import {
  parseFilterExpression,
  applyFiltersToNames,
  type FilterExpression,
  type FilterContext,
} from "../filter.ts";

async function isDown(runner: Runner, target?: string): Promise<boolean> {
  // if there is no target name then the service is not down.
  if (!target) return false;

  const { data } = await compose.ps({
    cwd: runner.config.root,
  });

  const service = data.services.find((service: { name: string }) =>
    service.name.includes(target),
  );
  // if the service is not found or is not "up" then it is down.
  return !service?.state?.toLowerCase().includes("up");
}

type RunScriptArgs = {
  command: string;
  subcommand: string | undefined;
  targets: string[];
  filters: FilterExpression[];
  since?: string;
  explicitTargets: boolean;
};

export default class RunScript extends TargetScript<RunScriptArgs> {
  static override name = "run";
  static override description =
    "Run a nopo.yml command inside Docker containers";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: async (runner) => {
        const args = RunScript.parseArgs(runner, false);
        if (args.targets.length === 0) return false;
        const target = args.targets[0];
        return (
          (await isDown(runner, target)) && (isBuild(runner) || isPull(runner))
        );
      },
    },
    {
      class: BuildScript,
      enabled: async (runner) => {
        const args = RunScript.parseArgs(runner, false);
        if (args.targets.length === 0) return false;
        const target = args.targets[0];
        return (await isDown(runner, target)) && isBuild(runner);
      },
    },
    {
      class: PullScript,
      enabled: async (runner) => {
        const args = RunScript.parseArgs(runner, false);
        if (args.targets.length === 0) return false;
        const target = args.targets[0];
        return (await isDown(runner, target)) && isPull(runner);
      },
    },
  ];

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): RunScriptArgs {
    if (isDependency || runner.argv.length <= 1) {
      return {
        command: "",
        subcommand: undefined,
        targets: [],
        filters: [],
        explicitTargets: false,
      };
    }

    // Skip "run" and get the command
    const argv = runner.argv.slice(1);
    const command = argv[0]!;

    if (!command) {
      throw new Error("Usage: run <command> [subcommand] [targets...]");
    }

    const remaining = argv.slice(1);
    const availableTargets = runner.config.targets;

    // Parse with minimist to extract --filter and --since options
    const parsed = minimist(remaining, {
      string: ["filter", "since"],
      alias: { F: "filter" },
    });

    // Parse filter expressions
    let filters: FilterExpression[] = [];
    const filterValue = parsed.filter;
    if (filterValue) {
      const filterArgs = Array.isArray(filterValue)
        ? filterValue
        : [filterValue];
      filters = filterArgs
        .filter((f): f is string => typeof f === "string" && f.length > 0)
        .map(parseFilterExpression);
    }

    // Get since value
    const since =
      typeof parsed.since === "string" ? parsed.since : undefined;

    // Use positional args for subcommand/target detection
    const positionalArgs: string[] = parsed._ || [];

    // Parse remaining args to determine subcommand vs targets
    let subcommand: string | undefined;
    let targets: string[] = [];
    let explicitTargets = false;

    if (positionalArgs.length > 0) {
      const firstArg = positionalArgs[0]!;

      // Check if firstArg is a known subcommand for this command
      const isSubcommand = RunScript.#isSubcommandName(
        runner,
        command,
        firstArg,
      );
      const isTarget = availableTargets.includes(firstArg.toLowerCase());

      if (isSubcommand && !isTarget) {
        subcommand = firstArg;
        targets = positionalArgs.slice(1).map((t) => t.toLowerCase());
        explicitTargets = positionalArgs.length > 1;
      } else if (!isSubcommand && isTarget) {
        targets = positionalArgs.map((t) => t.toLowerCase());
        explicitTargets = true;
      } else if (isSubcommand && isTarget) {
        // Ambiguous - prefer subcommand if there are more args
        if (positionalArgs.length > 1) {
          subcommand = firstArg;
          targets = positionalArgs.slice(1).map((t) => t.toLowerCase());
          explicitTargets = true;
        } else {
          targets = [firstArg.toLowerCase()];
          explicitTargets = true;
        }
      } else {
        // Not a known subcommand or target - treat as targets (validation happens below)
        targets = positionalArgs.map((t) => t.toLowerCase());
        explicitTargets = true;
      }
    }

    // Apply filters to get filtered target list
    let filteredTargets = availableTargets;
    if (filters.length > 0) {
      const context: FilterContext = {
        projectRoot: runner.config.root,
        since,
      };
      filteredTargets = applyFiltersToNames(
        availableTargets,
        runner.config.project.services.entries,
        filters,
        context,
      );
    }

    // Validate explicit targets
    if (targets.length > 0) {
      const unknown = targets.filter((t) => !availableTargets.includes(t));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown target${unknown.length > 1 ? "s" : ""} '${unknown.join("', '")}'. ` +
            `Available targets: ${availableTargets.join(", ")}`,
        );
      }
      // Intersect with filtered targets
      if (filters.length > 0) {
        targets = targets.filter((t) => filteredTargets.includes(t));
      }
    } else if (filters.length > 0) {
      // No explicit targets - use filtered targets
      targets = filteredTargets;
    }

    return {
      command,
      subcommand,
      targets,
      filters,
      since,
      explicitTargets,
    };
  }

  /**
   * Check if a name is a known subcommand for the given command across any service
   */
  static #isSubcommandName(
    runner: Runner,
    commandName: string,
    name: string,
  ): boolean {
    const project = runner.config.project;

    for (const service of Object.values(project.services.entries)) {
      const cmd = service.commands[commandName];
      if (cmd?.commands && cmd.commands[name]) {
        return true;
      }
    }

    return false;
  }

  override async fn(args: RunScriptArgs) {
    if (!args.command) {
      throw new Error("Command name is required");
    }

    const project = this.runner.config.project;

    // Build command path with optional subcommand
    const commandPath = args.subcommand
      ? `${args.command}:${args.subcommand}`
      : args.command;

    let targets: string[];
    if (args.targets.length > 0) {
      // Validate that all targets have the command
      validateCommandTargets(project, args.command, args.targets);
      targets = args.targets;
    } else if (args.explicitTargets) {
      // User explicitly provided targets but they were all filtered out
      this.log(`No targets matched after filtering`);
      return;
    } else {
      // If no targets specified, filter to only services that have the command
      const rootCommand = args.command.split(":")[0]!;
      targets = project.services.targets.filter((serviceId) => {
        const service = project.services.entries[serviceId];
        return service && service.commands[rootCommand];
      });

      if (targets.length === 0) {
        throw new Error(`No services have command '${args.command}'`);
      }
    }

    this.log(
      `Executing ${commandPath} in containers: ${targets.join(", ")}`,
    );

    // Run command in each target container
    for (const target of targets) {
      // Resolve command for this target
      const resolvedCommands = resolveCommand(project, commandPath, target);

      // Execute each resolved command (handles subcommands)
      for (const task of resolvedCommands) {
        await this.#executeTask(task);
      }
    }
  }

  /**
   * Execute a single task (resolved command) in a container
   */
  async #executeTask(task: ResolvedCommand): Promise<void> {
    const service = this.runner.config.project.services.entries[task.service];
    if (!service) {
      throw new Error(`Service '${task.service}' not found`);
    }

    if (!task.executable) {
      throw new Error(`Empty command for ${task.service}:${task.command}`);
    }

    // Create a prefixed logger for this task
    const commandPath = task.command;
    const logPrefix = `${task.service}:${commandPath}`;

    // Log that we're starting this task
    this.log(`[${logPrefix}] ${task.executable}`);

    // Merge environment variables: base env + task-specific env
    const taskEnv = task.env ? { ...this.env, ...task.env } : this.env;

    // Resolve working directory for the container
    // Note: The container runs from the service root by default
    // The dir option is relative to the service root
    const workdirOptions: string[] = [];
    if (task.dir) {
      const containerWorkdir = this.#resolveContainerWorkdir(task, service.paths.root);
      workdirOptions.push("--workdir", containerWorkdir);
    }

    // Execute the command in the container through a shell
    await compose.run(task.service, ["sh", "-c", task.executable], {
      callback: createLogger(logPrefix),
      commandOptions: ["--rm", "--remove-orphans", ...workdirOptions],
      env: taskEnv,
    });
  }

  /**
   * Resolve the working directory for a container task.
   * - undefined: use service root (default)
   * - "root": use project root
   * - absolute path: use as-is
   * - relative path: resolve relative to service root
   */
  #resolveContainerWorkdir(task: ResolvedCommand, serviceRoot: string): string {
    const dir = task.dir;

    // Default: service root
    if (!dir) {
      return serviceRoot;
    }

    // "root" means project root
    if (dir === "root") {
      return this.runner.config.root;
    }

    // Absolute path: use as-is
    if (path.isAbsolute(dir)) {
      return dir;
    }

    // Relative path: resolve relative to service root
    return path.resolve(serviceRoot, dir);
  }
}
