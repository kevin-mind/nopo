import compose from "docker-compose";
import { Script } from "../lib.js";
import EnvScript from "./env.js";
import ImageScript from "./image.js";

import { ParseEnv } from "../parse-env.js";
export default class UpScript extends Script {
  static name = "up";
  static description = "Start the services";
  static dependencies = [EnvScript, ImageScript];

  async fn() {
    const { env } = new ParseEnv(this.config);
    const dockerEnv = {
      ...this.config.processEnv,
      ...env,
    };

    const { data } = await compose.config({
      cwd: this.config.root,
      env: dockerEnv,
    });
    const downServices = [];

    for (const [name, service] of Object.entries(data.config.services)) {
      if (typeof service === "string") continue;
      if (service.image !== env.DOCKER_TAG) continue;
      downServices.push(name);
    }

    const createLogger = (name) => (chunk, streamSource) => {
      const messages = chunk.toString().trim().split("\n");
      const log = streamSource === "stdout" ? console.log : console.error;
      for (const message of messages) {
        log(`[${name}] ${message}`);
      }
    };

    await Promise.all([
      compose.run("base", "/app/docker/sync-host.sh", {
        callback: createLogger("sync"),
        config: ["docker/docker-compose.base.yml"],
        commandOptions: ["--rm", "--no-deps"],
        env: dockerEnv,
      }),
      compose.downMany(downServices, {
        callback: createLogger("down"),
        commandOptions: ["--remove-orphans"],
        env: dockerEnv,
      }),
      compose.pullAll({
        callback: createLogger("pull"),
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      throw new Error("Failed to start services");
    }
  }
}
