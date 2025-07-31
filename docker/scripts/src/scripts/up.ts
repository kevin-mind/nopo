import compose from "docker-compose";
import { chalk } from "zx";

import { Script, type ScriptDependency, type Runner } from "../lib.js";
import EnvScript from "./env.js";
import BuildScript from "./build.js";
import PullScript from "./pull.js";

export function isBuild({ config, environment }: Runner): boolean {
  const forceBuild = !!config.processEnv.DOCKER_BUILD;
  const localVersion = environment.env.DOCKER_VERSION === "local";
  return forceBuild || localVersion;
}

export function isPull(runner: Runner): boolean {
  return !isBuild(runner);
}

export default class UpScript extends Script {
  static override name = "up";
  static override description = "Start the services";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
    {
      class: BuildScript,
      enabled: isBuild,
    },
    {
      class: PullScript,
      enabled: isPull,
    },
  ];

  override async fn() {
    const { data } = await compose.config({
      cwd: this.runner.config.root,
      env: this.env,
    });
    const downServices: string[] = [];

    for (const [name, service] of Object.entries(data.config.services)) {
      if (typeof service === "string") continue;
      if (service.image !== this.runner.environment.env.DOCKER_TAG) continue;
      downServices.push(name);
    }

    const createLogger =
      (name: string, color: string = "black") =>
      (chunk: Buffer, streamSource?: "stdout" | "stderr"): void => {
        const messages = chunk.toString().trim().split("\n");
        const log = streamSource === "stdout" ? console.log : console.error;
        for (const message of messages) {
          const colorFn =
            color === "green"
              ? chalk.green
              : color === "yellow"
                ? chalk.yellow
                : color === "blue"
                  ? chalk.blue
                  : chalk.white;
          log(colorFn(`[${name}] ${message}`));
        }
      };

    await Promise.all([
      compose.run("base", "/app/docker/sync-host.sh", {
        callback: createLogger("sync", "green"),
        config: ["docker/docker-compose.sync.yml"],
        commandOptions: ["--rm", "--no-deps", "--remove-orphans"],
        env: this.env,
      }),
      compose.downMany(downServices, {
        callback: createLogger("down", "yellow"),
        commandOptions: ["--remove-orphans"],
        env: this.env,
      }),
      compose.pullAll({
        callback: createLogger("pull", "blue"),
        commandOptions: ["--ignore-pull-failures"],
        env: this.env,
      }),
    ]);

    try {
      await compose.upAll({
        callback: createLogger("up"),
        commandOptions: ["--remove-orphans", "-d", "--no-build", "--wait"],
        env: this.env,
      });
    } catch (error) {
      await Promise.all(
        Object.keys(data.config.services).map((service) =>
          compose.logs(service, {
            callback: createLogger(`log:${service}`),
            commandOptions: ["--no-log-prefix"],
            env: this.env,
          }),
        ),
      );
      throw new Error("Failed to start services", { cause: error });
    }
  }
}
