import { TargetScript, type ScriptDependency, type Runner } from "../lib.ts";
import { parseTargetArgs } from "../target-args.ts";
import EnvScript from "./env.ts";

type IndexScriptArgs = {
  script: string;
  targets: string[];
};

export default class IndexScript extends TargetScript<IndexScriptArgs> {
  static override name = "";
  static override description = "Run a pnpm script on the host machine";
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

  override async fn(args: IndexScriptArgs) {
    if (!args.script) {
      throw new Error("Script name is required");
    }

    const scriptCmd = this.#resolveScript(args.script);

    if (args.targets.length === 0) {
      // Run at root level
      await this.exec`${scriptCmd}`;
      return;
    }

    // Run for each target
    for (const target of args.targets) {
      const targetScriptCmd = this.#resolveScript(args.script);
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
}
