import compose from "docker-compose";
import { chalk } from "zx";

import { Script } from "../lib.js";
import EnvScript from "./env.js";
import BuildScript from "./build.js";
import PullScript from "./pull.js";

function isBuild({ config, environment }) {
  const forceBuild = !!config.processEnv.DOCKER_BUILD;
  const localVersion = environment.env.DOCKER_VERSION === "local";
  return forceBuild || localVersion;
}

function isPull(runner) {
  return !isBuild(runner);
}

export default class UpScript extends Script {
  static name = "up";
  static description = "Start the services";
  static dependencies = [
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

  async fn() {
    const dockerEnv = {
      ...this.runner.environment.processEnv,
      ...this.runner.environment.env,
    };

    const { data } = await compose.config({
      cwd: this.runner.config.root,
      env: dockerEnv,
    });
    const downServices = [];

    for (const [name, service] of Object.entries(data.config.services)) {
      if (typeof service === "string") continue;
      if (service.image !== this.runner.environment.env.DOCKER_TAG) continue;
      downServices.push(name);
    }

    const createLogger =
      (name, color = "black") =>
      (chunk, streamSource) => {
        const messages = chunk.toString().trim().split("\n");
        const log = streamSource === "stdout" ? console.log : console.error;
        for (const message of messages) {
          log(chalk[color](`[${name}] ${message}`));
        }
      };

    await Promise.all([
      compose.run("base", "/app/docker/sync-host.sh", {
        callback: createLogger("sync", "green"),
        config: ["docker/docker-compose.sync.yml"],
        commandOptions: ["--rm", "--no-deps", "--remove-orphans"],
        env: dockerEnv,
      }),
      compose.downMany(downServices, {
        callback: createLogger("down", "yellow"),
        commandOptions: ["--remove-orphans"],
        env: dockerEnv,
      }),
      compose.pullAll({
        callback: createLogger("pull", "blue"),
        commandOptions: ["--ignore-pull-failures"],
        env: dockerEnv,
      }),
    ]);

    try {
      await compose.upAll({
        callback: createLogger("up"),
        commandOptions: ["--remove-orphans", "-d", "--no-build", "--wait"],
        env: dockerEnv,
      });
    } catch (error) {
      await Promise.all(
        Object.keys(data.config.services).map((service) =>
          compose.logs(service, {
            callback: createLogger(`log:${service}`),
            commandOptions: ["--no-log-prefix"],
            env: dockerEnv,
          }),
        ),
      );
      throw new Error("Failed to start services", { cause: error });
    }
  }
}
