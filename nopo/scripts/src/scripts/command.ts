import path from "node:path";
import compose from "docker-compose";
import {
  TargetScript,
  type ScriptDependency,
  type Runner,
  exec,
  createLogger,
  minimist,
} from "../lib.ts";
import EnvScript from "./env.ts";
import BuildScript from "./build.ts";
import PullScript from "./pull.ts";
import { isBuild, isPull } from "./up.ts";
import {
  validateCommandTargets,
  buildExecutionPlan,
  type ResolvedCommand,
} from "../commands/index.ts";
import {
  parseFilterExpression,
  applyFiltersToNames,
  type FilterExpression,
  type FilterContext,
} from "../filter.ts";
import type { CommandContext } from "../config/index.ts";

/**
 * Check if any target container is down.
 */
async function hasDownContainer(
  runner: Runner,
  targets: string[],
): Promise<boolean> {
  if (targets.length === 0) return false;

  const { data } = await compose.ps({
    cwd: runner.config.root,
  });

  for (const target of targets) {
    const service = data.services.find((service: { name: string }) =>
      service.name.includes(target),
    );
    // If the service is not found or is not "up" then it is down
    if (!service?.state?.toLowerCase().includes("up")) {
      return true;
    }
  }

  return false;
}

type CommandScriptArgs = {
  command: string;
  subcommand: string | undefined;
  targets: string[];
  filters: FilterExpression[];
  since?: string;
  explicitTargets: boolean;
  contextOverride?: CommandContext; // CLI override for execution context
};

/**
 * Check if any task will execute in container context.
 * This is used to determine if we need to build/pull images.
 */
function willExecuteInContainer(
  runner: Runner,
  args: CommandScriptArgs,
): boolean {
  // If explicit CLI override to host, no container execution
  if (args.contextOverride === "host") return false;

  // If explicit CLI override to container, yes container execution
  if (args.contextOverride === "container") return true;

  // Check if any command has context: container configured
  const project = runner.config.project;
  const rootCommand = args.command.split(":")[0];
  if (!rootCommand) return false;

  for (const serviceId of args.targets) {
    const service = project.services.entries[serviceId];
    const cmd = service?.commands[rootCommand];
    if (cmd?.context === "container") return true;
  }

  return false;
}

export default class CommandScript extends TargetScript<CommandScriptArgs> {
  static override name = "";
  static override description = "Run a command defined in nopo.yml";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
    {
      class: BuildScript,
      enabled: async (runner) => {
        const args = CommandScript.parseArgs(runner, false);
        if (args.targets.length === 0) return false;
        if (!willExecuteInContainer(runner, args)) return false;
        return (
          (await hasDownContainer(runner, args.targets)) && isBuild(runner)
        );
      },
    },
    {
      class: PullScript,
      enabled: async (runner) => {
        const args = CommandScript.parseArgs(runner, false);
        if (args.targets.length === 0) return false;
        if (!willExecuteInContainer(runner, args)) return false;
        if (!isPull(runner)) return false;
        // Always pull if we have targets and it's container execution in pull mode
        return true;
      },
      // Pass targets from CommandScript to PullScript
      args: (parentArgs) => ({
        targets: parentArgs.get("targets"),
      }),
    },
  ];

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): CommandScriptArgs {
    if (isDependency || runner.argv.length === 0) {
      return {
        command: "",
        subcommand: undefined,
        targets: [],
        filters: [],
        explicitTargets: false,
      };
    }

    const argv = runner.argv;
    const command = argv[0]!;

    // Skip parsing if "help" is the script name (handled by main entry point)
    if (command === "help") {
      return {
        command: "",
        subcommand: undefined,
        targets: [],
        filters: [],
        explicitTargets: false,
      };
    }

    const remaining = argv.slice(1);
    const availableTargets = runner.config.targets;

    // Parse with minimist to extract --filter, --since, and --context options
    const parsed = minimist(remaining, {
      string: ["filter", "since", "context"],
      alias: { F: "filter" },
    });

    // Parse context override
    let contextOverride: CommandContext | undefined;
    if (parsed.context === "host" || parsed.context === "container") {
      contextOverride = parsed.context;
    } else if (parsed.context !== undefined) {
      throw new Error(
        `Invalid --context value '${parsed.context}'. Must be 'host' or 'container'.`,
      );
    }

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
    const since = typeof parsed.since === "string" ? parsed.since : undefined;

    // Use positional args (non-option args) for subcommand/target detection
    const positionalArgs: string[] = parsed._ || [];

    // Parse remaining args to determine subcommand vs targets
    // Logic: if second arg matches a known subcommand, it's a subcommand
    // otherwise all remaining args are targets
    let subcommand: string | undefined;
    let targets: string[] = [];
    // Track whether user provided explicit targets (before filtering)
    let explicitTargets = false;

    if (positionalArgs.length > 0) {
      const firstArg = positionalArgs[0]!;

      // Check if firstArg is a known subcommand for this command
      const isSubcommand = CommandScript.#isSubcommandName(
        runner,
        command,
        firstArg,
      );
      const isTarget = availableTargets.includes(firstArg.toLowerCase());

      if (isSubcommand && !isTarget) {
        // It's definitely a subcommand
        subcommand = firstArg;
        targets = positionalArgs.slice(1).map((t) => t.toLowerCase());
        // Explicit targets are the ones after the subcommand
        explicitTargets = positionalArgs.length > 1;
      } else if (!isSubcommand && isTarget) {
        // It's definitely a target
        targets = positionalArgs.map((t) => t.toLowerCase());
        explicitTargets = true;
      } else if (isSubcommand && isTarget) {
        // Ambiguous - could be either. Prefer subcommand interpretation
        // if there are more args (suggesting the pattern: cmd subcommand target)
        if (positionalArgs.length > 1) {
          subcommand = firstArg;
          targets = positionalArgs.slice(1).map((t) => t.toLowerCase());
          explicitTargets = true;
        } else {
          // Single arg that could be either - treat as target
          targets = [firstArg.toLowerCase()];
          explicitTargets = true;
        }
      } else {
        // Not a known subcommand or target - treat all remaining as targets
        // (validation will happen below)
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
      contextOverride,
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

  override async fn(args: CommandScriptArgs) {
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
      // If explicit targets are specified, validate that all of them have the command
      validateCommandTargets(project, args.command, args.targets);
      targets = args.targets;
    } else if (args.explicitTargets) {
      // User explicitly provided targets but they were all filtered out
      // Don't fallback to all services - just run on zero targets (effectively a no-op)
      this.log(`No targets matched after filtering`);
      return;
    } else {
      // If no targets specified, filter to only services that have the command
      // Check for the full command path (including subcommand if present)
      targets = project.services.targets.filter((serviceId) => {
        const service = project.services.entries[serviceId];
        if (!service) return false;

        const rootCommand = args.command.split(":")[0]!;
        const cmd = service.commands[rootCommand];
        if (!cmd) return false;

        // If there's a subcommand, check that it exists too
        if (args.subcommand) {
          return !!(cmd.commands && cmd.commands[args.subcommand]);
        }

        return true;
      });

      if (targets.length === 0) {
        throw new Error(`No services have command '${commandPath}'`);
      }
    }

    // Build execution plan
    const plan = buildExecutionPlan(project, commandPath, targets);

    this.log(`Executing ${commandPath} across ${targets.join(", ")}`);
    this.log(`Execution plan: ${plan.stages.length} stage(s)`);

    // Execute each stage
    for (let i = 0; i < plan.stages.length; i++) {
      const stage = plan.stages[i]!;
      this.log(
        `\nStage ${i + 1}: ${stage.map((t) => `${t.service}:${t.command}`).join(", ")}`,
      );

      // Run all commands in this stage in parallel
      await Promise.all(
        stage.map((task) => this.#executeTask(task, args.contextOverride)),
      );
    }
  }

  /**
   * Execute a single task (resolved command).
   * Routes to host or container execution based on context.
   */
  async #executeTask(
    task: ResolvedCommand,
    contextOverride?: CommandContext,
  ): Promise<void> {
    const service = this.runner.config.project.services.entries[task.service];
    if (!service) {
      throw new Error(`Service '${task.service}' not found`);
    }

    if (!task.executable) {
      throw new Error(`Empty command for ${task.service}:${task.command}`);
    }

    // Determine effective context: CLI override > task config > default (host)
    const effectiveContext = contextOverride ?? task.context ?? "host";

    if (effectiveContext === "container") {
      await this.#executeInContainer(task, service.paths.root);
    } else {
      await this.#executeOnHost(task, service.paths.root);
    }
  }

  /**
   * Execute a task on the host machine.
   */
  async #executeOnHost(
    task: ResolvedCommand,
    serviceRoot: string,
  ): Promise<void> {
    // Resolve working directory
    const cwd = this.#resolveWorkingDirectory(task, serviceRoot);

    // Merge environment variables: base env + task-specific env
    const taskEnv = task.env ? { ...this.env, ...task.env } : this.env;

    // Create a prefixed logger for this task
    const logPrefix = `${task.service}:${task.command}`;

    // Log that we're starting this task
    this.log(`[${logPrefix}] ${task.executable}`);

    // Execute the command through a shell to support shell operators like &&, ||, |, etc.
    await exec("sh", ["-c", task.executable], {
      cwd,
      env: taskEnv,
      stdio: "pipe",
      callback: createLogger(logPrefix, "cyan"),
    });
  }

  /**
   * Execute a task in a Docker container.
   */
  async #executeInContainer(
    task: ResolvedCommand,
    serviceRoot: string,
  ): Promise<void> {
    // Create a prefixed logger for this task
    const logPrefix = `${task.service}:${task.command}`;

    // Merge environment variables: base env + task-specific env
    const taskEnv = task.env ? { ...this.env, ...task.env } : this.env;

    // Resolve working directory for the container (always set, default to service root)
    const containerWorkdir = this.#resolveContainerWorkdir(task, serviceRoot);

    // Build and log the full docker compose command
    const commandOptions = [
      "--rm",
      "--remove-orphans",
      "--workdir",
      containerWorkdir,
    ];
    const composeCmd = [
      "docker compose",
      "run",
      ...commandOptions,
      task.service,
      "sh",
      "-c",
      `"${task.executable}"`,
    ].join(" ");
    this.log(`[${logPrefix}] ${composeCmd}`);

    // Execute the command in the container through a shell
    await compose.run(task.service, ["sh", "-c", task.executable], {
      cwd: this.runner.config.root,
      callback: createLogger(logPrefix, "cyan"),
      commandOptions,
      env: taskEnv,
    });
  }

  /**
   * Resolve the working directory for a host task.
   * - undefined: use service root (default)
   * - "root": use project root
   * - absolute path: use as-is
   * - relative path: resolve relative to service root
   */
  #resolveWorkingDirectory(task: ResolvedCommand, serviceRoot: string): string {
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

  /**
   * Resolve the working directory for a container task.
   * Converts host paths to container paths.
   * - undefined: use service root (default)
   * - "root": use project root
   * - absolute path: use as-is (assumed to be container path)
   * - relative path: resolve relative to service root
   */
  #resolveContainerWorkdir(task: ResolvedCommand, serviceRoot: string): string {
    const dir = task.dir;
    const hostRoot = this.runner.config.root;
    // Container mount point - project is mounted at /app
    const containerRoot = "/app";

    // Helper to convert host path to container path
    const toContainerPath = (hostPath: string): string => {
      if (hostPath.startsWith(hostRoot)) {
        const relativePath = path.relative(hostRoot, hostPath);
        return path.posix.join(containerRoot, relativePath);
      }
      // Already a container path or unknown - return as-is
      return hostPath;
    };

    // Default: service root
    if (!dir) {
      return toContainerPath(serviceRoot);
    }

    // "root" means project root
    if (dir === "root") {
      return containerRoot;
    }

    // Absolute path starting with container root: use as-is
    if (dir.startsWith(containerRoot) || dir.startsWith("/")) {
      return dir;
    }

    // Relative path: resolve relative to service root, then convert
    const hostPath = path.resolve(serviceRoot, dir);
    return toContainerPath(hostPath);
  }
}
