import { chalk, minimist } from "zx";
import compose from "docker-compose";

import EnvScript from "./env.js";
import BuildScript from "./build.js";
import PullScript from "./pull.js";
import { isBuild, isPull } from "./up.js";

import { Script } from "../lib.js";

async function isDown(runner) {
  const args = IndexScript.args(runner);
  // if there is no service name then the service is not down.
  if (!args.service) return false;

  const { data } = await compose.ps({
    cwd: runner.config.root,
  });

  const service = data.services.find((service) =>
    service.name.includes(args.service),
  );
  // if the service is not found or is not "up" then it is down.
  return !service?.state?.toLowerCase().includes("up");
}

export default class IndexScript extends Script {
  static name = "run";
  static description = "Run a pnpm script in a specified service and package";
  static dependencies = [
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

  static args(runner) {
    let {
      _: [script, service],
      workspace,
    } = minimist(runner.argv);

    if (service && !workspace) {
      workspace = service;
    }

    return { script, service, workspace };
  }

  async #resolveScript(args) {
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

  async fn() {
    const args = IndexScript.args(this.runner);
    const script = await this.#resolveScript(args);

    if (!args.service) return await this.exec`${script}`;

    const createLogger =
      (name, color = "black") =>
      (chunk, streamSource) => {
        const messages = chunk.toString().trim().split("\n");
        const log = streamSource === "stdout" ? console.log : console.error;
        for (const message of messages) {
          log(chalk[color](`[${name}] ${message}`));
        }
      };

    return await compose.run(args.service, script, {
      callback: createLogger(args.service, "white"),
      commandOptions: ["--rm", "--remove-orphans"],
      env: this.env,
    });
  }
}
