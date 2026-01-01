import { TargetScript, type ScriptDependency, type Runner, exec } from "../lib.ts";
import { parseTargetArgs } from "../target-args.ts";
import EnvScript from "./env.ts";
import {
  validateCommandTargets,
  buildExecutionPlan,
  type ResolvedCommand,
} from "../commands/index.ts";

type IndexScriptArgs = {
  script: string;
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
      return { script: "", targets: [] };
    }

    const argv = runner.argv;
    const script = argv[0]!;

    // Skip parsing if "help" is the script name (handled by main entry point)
    if (script === "help") {
      return { script: "", targets: [] };
    }

    const parsed = parseTargetArgs(
      script,
      argv.slice(1),
      runner.config.targets,
    );

    return {
      script,
      targets: parsed.targets,
    };
  }

  override async fn(args: IndexScriptArgs) {
    if (!args.script) {
      throw new Error("Script name is required");
    }

    const project = this.runner.config.project;
    const targets = args.targets.length > 0 ? args.targets : project.services.targets;

    // Check if this command is defined in nopo.yml files
    const hasNopoCommand = this.#hasNopoCommand(args.script, targets);

    if (hasNopoCommand) {
      // Use nopo command resolution
      await this.#runNopoCommand(args.script, targets);
    } else {
      // Fall back to pnpm for commands not defined in nopo.yml
      await this.#runPnpmCommand(args.script, args.targets);
    }
  }

  /**
   * Check if any of the targets have this command defined in nopo.yml
   */
  #hasNopoCommand(script: string, targets: string[]): boolean {
    const project = this.runner.config.project;
    const rootCommand = script.split(":")[0]!;

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
  async #runNopoCommand(script: string, targets: string[]): Promise<void> {
    const project = this.runner.config.project;

    // Validate that all targets have the command
    validateCommandTargets(project, script, targets);

    // Build execution plan
    const plan = buildExecutionPlan(project, script, targets);

    this.log(`Executing ${script} across ${targets.join(", ")}`);
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
