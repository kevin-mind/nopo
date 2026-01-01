import path from "node:path";
import {
  TargetScript,
  type ScriptDependency,
  type Runner,
  exec,
} from "../lib.ts";
import EnvScript from "./env.ts";
import {
  validateCommandTargets,
  buildExecutionPlan,
  type ResolvedCommand,
} from "../commands/index.ts";

type CommandScriptArgs = {
  command: string;
  subcommand: string | undefined;
  targets: string[];
};

export default class CommandScript extends TargetScript<CommandScriptArgs> {
  static override name = "";
  static override description = "Run a command defined in nopo.yml";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): CommandScriptArgs {
    if (isDependency || runner.argv.length === 0) {
      return { command: "", subcommand: undefined, targets: [] };
    }

    const argv = runner.argv;
    const command = argv[0]!;

    // Skip parsing if "help" is the script name (handled by main entry point)
    if (command === "help") {
      return { command: "", subcommand: undefined, targets: [] };
    }

    const remaining = argv.slice(1);
    const availableTargets = runner.config.targets;

    // Parse remaining args to determine subcommand vs targets
    // Logic: if second arg matches a known subcommand, it's a subcommand
    // otherwise all remaining args are targets
    let subcommand: string | undefined;
    let targets: string[] = [];

    if (remaining.length > 0) {
      const firstArg = remaining[0]!;

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
        targets = remaining.slice(1).map((t) => t.toLowerCase());
      } else if (!isSubcommand && isTarget) {
        // It's definitely a target
        targets = remaining.map((t) => t.toLowerCase());
      } else if (isSubcommand && isTarget) {
        // Ambiguous - could be either. Prefer subcommand interpretation
        // if there are more args (suggesting the pattern: cmd subcommand target)
        if (remaining.length > 1) {
          subcommand = firstArg;
          targets = remaining.slice(1).map((t) => t.toLowerCase());
        } else {
          // Single arg that could be either - treat as target
          targets = [firstArg.toLowerCase()];
        }
      } else {
        // Not a known subcommand or target - treat all remaining as targets
        // (validation will happen below)
        targets = remaining.map((t) => t.toLowerCase());
      }
    }

    // Validate targets
    if (targets.length > 0) {
      const unknown = targets.filter((t) => !availableTargets.includes(t));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown target${unknown.length > 1 ? "s" : ""} '${unknown.join("', '")}'. ` +
            `Available targets: ${availableTargets.join(", ")}`,
        );
      }
    }

    return { command, subcommand, targets };
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
    const targets =
      args.targets.length > 0 ? args.targets : project.services.targets;

    // Build command path with optional subcommand
    const commandPath = args.subcommand
      ? `${args.command}:${args.subcommand}`
      : args.command;

    // Validate that all targets have the command defined
    validateCommandTargets(project, args.command, targets);

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
      await Promise.all(stage.map((task) => this.#executeTask(task)));
    }
  }

  /**
   * Execute a single task (resolved command)
   */
  async #executeTask(task: ResolvedCommand): Promise<void> {
    const service = this.runner.config.project.services.entries[task.service];
    if (!service) {
      throw new Error(`Service '${task.service}' not found`);
    }

    this.log(`Running ${task.command} on ${task.service}: ${task.executable}`);

    // Parse the command string into parts
    const parts = task.executable.split(/\s+/);
    const [cmd, ...cmdArgs] = parts;

    if (!cmd) {
      throw new Error(`Empty command for ${task.service}:${task.command}`);
    }

    // Resolve working directory
    const cwd = this.#resolveWorkingDirectory(task, service.paths.root);

    // Merge environment variables: base env + task-specific env
    const taskEnv = task.env ? { ...this.env, ...task.env } : this.env;

    await exec(cmd, cmdArgs, {
      cwd,
      env: taskEnv,
      stdio: "inherit",
    });
  }

  /**
   * Resolve the working directory for a task.
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
}
