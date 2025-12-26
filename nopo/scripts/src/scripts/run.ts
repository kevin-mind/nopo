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
} from "../lib.ts";
import { parseTargetArgs } from "../target-args.ts";

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
  script: string;
  targets: string[];
  workspace: string;
};

export default class RunScript extends TargetScript<RunScriptArgs> {
  static override name = "run";
  static override description =
    "Run a pnpm script in a specified service and package";
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _isDependency: boolean,
  ): RunScriptArgs {
    const argv = runner.argv.slice(1);
    const parsed = parseTargetArgs("run", argv, runner.config.targets, {
      leadingPositionals: 1,
      string: ["workspace"],
    });

    if (parsed.leadingArgs.length === 0) {
      throw new Error("Usage: run [script] [targets...] [--workspace <name>]");
    }

    const script = parsed.leadingArgs[0]!;
    const workspaceValue = parsed.options["workspace"];
    const workspace: string =
      typeof workspaceValue === "string" ? workspaceValue : "";

    return {
      script,
      targets: parsed.targets,
      workspace,
    };
  }

  async #resolveScript(args: RunScriptArgs): Promise<string[]> {
    const script = ["pnpm", "run"];
    if (args.workspace) {
      script.push("--filter", `@more/${args.workspace}`);
    } else {
      script.push("--fail-if-no-match");
    }
    script.push(`/^${args.script}.*/`);

    return script;
  }

  override async fn(args: RunScriptArgs) {
    const script = await this.#resolveScript(args);

    if (args.targets.length === 0) {
      await this.exec`${script}`;
      return;
    }

    // Run script in each specified target
    for (const target of args.targets) {
      await compose.run(target, script, {
        callback: createLogger(target),
        commandOptions: ["--rm", "--remove-orphans"],
        env: this.env,
      });
    }
  }
}
