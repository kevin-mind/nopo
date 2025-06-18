import compose from "docker-compose";
import { chalk } from "zx";
import { Script } from "../lib.js";
import EnvScript from "./env.js";

import { ParseEnv } from "../parse-env.js";

export default class ImageScript extends Script {
  static name = "image";
  static description = "Build or pull the base image";
  static dependencies = [EnvScript];

  log(...message) {
    this.logger.log(chalk.yellow(...message, "\n"));
  }

  async fn() {
    const { env } = new ParseEnv(this.config);
    const isBuild = !!this.config.processEnv.DOCKER_BUILD;
    const isLocal = env.DOCKER_VERSION === "local";

    const dockerEnv = {
      ...this.config.processEnv,
      ...env,
      COMPOSE_BAKE: "true",
    };

    if (isBuild || isLocal) {
      const commandOptions = [];

      this.log(`Building image: ${env.DOCKER_TAG}`);

      if (this.config.processEnv.DOCKER_BUILDER) {
        this.log("- builder:", this.config.processEnv.DOCKER_BUILDER);
        commandOptions.push("--builder", this.config.processEnv.DOCKER_BUILDER);
      }

      const options = {
        log: true,
        config: ["docker/docker-compose.build.yml"],
        commandOptions,
        env: dockerEnv,
      };

      await compose.buildOne("base", {
        ...options,
        commandOptions: ["--print", ...commandOptions],
      });
      await compose.buildOne("base", options);
    } else {
      this.log(`Pulling image: ${env.DOCKER_TAG}`);
      await compose.pullOne("base", {
        log: true,
        config: ["docker/docker-compose.base.yml"],
        commandOptions: ["--policy", "always"],
        env: dockerEnv,
      });
    }
  }
}
