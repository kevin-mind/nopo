import compose from "docker-compose";
import { minimist } from "../lib.ts";

import EnvScript from "./env.ts";
import BuildScript from "./build.ts";
import PullScript from "./pull.ts";
import { isBuild, isPull } from "./up.ts";

import {
  Script,
  type ScriptDependency,
  type Runner,
  createLogger,
} from "../lib.ts";

async function isDown(runner: Runner): Promise<boolean> {
  const args = IndexScript.args(runner);
  // if there is no service name then the service is not down.
  if (!args.service) return false;

  const { data } = await compose.ps({
    cwd: runner.config.root,
  });

  const service = data.services.find((service: { name: string }) =>
    service.name.includes(args.service!),
  );
  // if the service is not found or is not "up" then it is down.
  return !service?.state?.toLowerCase().includes("up");
}

interface IndexScriptArgs {
  script: string;
  service: string;
  workspace: string;
}

export default class IndexScript extends Script {
  static override name = "run";
  static override description =
    "Run a pnpm script in a specified service and package";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: async (runner) =>
        (await isDown(runner)) && (isBuild(runner) || isPull(runner)),
    },
    {
      class: BuildScript,
      enabled: async (runner) => (await isDown(runner)) && isBuild(runner),
    },
    {
      class: PullScript,
      enabled: async (runner) => (await isDown(runner)) && isPull(runner),
    },
  ];

  static args(runner: Runner): IndexScriptArgs {
    const { _: [script = "", service = ""] = ["", ""], workspace = "" } =
      minimist(runner.argv);

    if (workspace !== undefined && typeof workspace !== "string") {
      throw new Error("--workspace must be a single string value");
    }

    return {
      script,
      service: service || workspace,
      workspace: workspace || service,
    };
  }

  async #resolveScript(args: IndexScriptArgs): Promise<string[]> {
    if (!args.script) {
      throw new Error(
        "Usage: run [script] --service [service] --workspace [workspace]",
      );
    }
    const script = ["pnpm", "run"];
    if (args.workspace) {
      script.push("--filter", `@more/${args.workspace}`);
    } else {
      script.push("--fail-if-no-match");
    }
    script.push(`/^${args.script}.*/`);

    return script;
  }

  override async fn() {
    const args = IndexScript.args(this.runner);
    const script = await this.#resolveScript(args);

    if (!args.service) {
      await this.exec`${script}`;
      return;
    }

    await compose.run(args.service, script, {
      callback: createLogger(args.service),
      commandOptions: ["--rm", "--remove-orphans"],
      env: this.env,
    });
  }
}
