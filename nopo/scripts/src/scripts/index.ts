import { TargetScript, type ScriptDependency, type Runner, exec } from "../lib.ts";
import EnvScript from "./env.ts";
import {
  validateCommandTargets,
  buildExecutionPlan,
  resolveCommand,
  type ResolvedCommand,
} from "../commands/index.ts";

type IndexScriptArgs = {
  command: string;
  subcommand: string | undefined;
  targets: string[];
};

export default class IndexScript extends TargetScript<IndexScriptArgs> {
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
  ): IndexScriptArgs {
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
      const isSubcommand = IndexScript.#isSubcommandName(runner, command, firstArg);
      const isTarget = availableTargets.includes(firstArg.toLowerCase());

      if (isSubcommand && !isTarget) {
        // It's definitely a subcommand
        subcommand = firstArg;
        targets = remaining.slice(1).map(t => t.toLowerCase());
      } else if (!isSubcommand && isTarget) {
        // It's definitely a target
        targets = remaining.map(t => t.toLowerCase());
      } else if (isSubcommand && isTarget) {
        // Ambiguous - could be either. Prefer subcommand interpretation
        // if there are more args (suggesting the pattern: cmd subcommand target)
        if (remaining.length > 1) {
          subcommand = firstArg;
          targets = remaining.slice(1).map(t => t.toLowerCase());
        } else {
          // Single arg that could be either - treat as target
          targets = [firstArg.toLowerCase()];
        }
      } else {
        // Not a known subcommand or target - treat all remaining as targets
        // (validation will happen below)
        targets = remaining.map(t => t.toLowerCase());
      }
    }

    // Validate targets
    if (targets.length > 0) {
      const unknown = targets.filter(t => !availableTargets.includes(t));
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
  static #isSubcommandName(runner: Runner, commandName: string, name: string): boolean {
    const project = runner.config.project;
    
    for (const service of Object.values(project.services.entries)) {
      const cmd = service.commands[commandName];
      if (cmd?.commands && cmd.commands[name]) {
        return true;
      }
    }
    
    return false;
  }

  override async fn(args: IndexScriptArgs) {
    if (!args.command) {
      throw new Error("Command name is required");
    }

    const project = this.runner.config.project;
    const targets = args.targets.length > 0 ? args.targets : project.services.targets;

    // Check if this command is defined in nopo.yml files
    const hasNopoCommand = this.#hasNopoCommand(args.command, targets);

    if (hasNopoCommand) {
      // Use nopo command resolution
      const commandPath = args.subcommand 
        ? `${args.command}:${args.subcommand}` 
        : args.command;
      await this.#runNopoCommand(commandPath, targets);
    } else {
      // Fall back to pnpm for commands not defined in nopo.yml
      await this.#runPnpmCommand(args.command, args.targets);
    }
  }

  /**
   * Check if any of the targets have this command defined in nopo.yml
   */
  #hasNopoCommand(command: string, targets: string[]): boolean {
    const project = this.runner.config.project;
    const rootCommand = command.split(":")[0]!;

    for (const target of targets) {
      const service = project.services.entries[target];
      if (service?.commands[rootCommand]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Run a command using nopo command resolution with dependency graph
   */
  async #runNopoCommand(commandPath: string, targets: string[]): Promise<void> {
    const project = this.runner.config.project;
    const rootCommand = commandPath.split(":")[0]!;

    // Validate that all targets have the root command
    validateCommandTargets(project, rootCommand, targets);

    // Build execution plan
    const plan = buildExecutionPlan(project, commandPath, targets);

    this.log(`Executing ${commandPath} across ${targets.join(", ")}`);
    this.log(`Execution plan: ${plan.stages.length} stage(s)`);

    // Execute each stage
    for (let i = 0; i < plan.stages.length; i++) {
      const stage = plan.stages[i]!;
      this.log(`\nStage ${i + 1}: ${stage.map(t => `${t.service}:${t.command}`).join(", ")}`);

      // Run all commands in this stage in parallel
      await Promise.all(stage.map(task => this.#executeTask(task)));
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

    // Execute in the service's root directory
    const cwd = service.paths.root;

    await exec(cmd, cmdArgs, {
      cwd,
      env: this.env,
      stdio: "inherit",
    });
  }

  /**
   * Fall back to pnpm command execution for commands not in nopo.yml
   */
  async #runPnpmCommand(scriptName: string, targets: string[]): Promise<void> {
    const scriptCmd = this.#resolveScript(scriptName);

    if (targets.length === 0) {
      // Run at root level
      await this.exec`${scriptCmd}`;
      return;
    }

    // Run for each target
    for (const target of targets) {
      const targetScriptCmd = this.#resolveScript(scriptName);
      // Insert --filter before the script name/pattern
      const filterCmd = [
        "pnpm",
        "--filter",
        `@more/${target}`,
        "run",
        ...targetScriptCmd.slice(2),
      ];
      await this.exec`${filterCmd}`;
    }
  }

  #resolveScript(scriptName: string): string[] {
    const script = ["pnpm", "run"];

    // Check if script name ends with ':' for pattern matching
    if (scriptName.endsWith(":")) {
      // Remove the trailing ':' and use regex pattern matching
      const prefix = scriptName.slice(0, -1);
      script.push(`/^${prefix}.*/`);
    } else {
      // Use exact script name
      script.push(scriptName);
    }

    return script;
  }
}
