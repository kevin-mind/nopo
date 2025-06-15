import compose from "docker-compose";
import { Script } from "../lib.js";
import EnvScript from "./env.js";

import { ParseEnv } from "../parse-env.js";

export default class ImageScript extends Script {
  static name = "image";
  static description = "Build or pull the base image";
  static dependencies = [EnvScript];

  async fn() {
    const { env } = new ParseEnv(this.config);
    if (env.DOCKER_REGISTRY) {
      this.logger.log("Pulling base image from registry");
      await compose.pullOne("base", {
        log: true,
        config: ["docker/docker-compose.base.yml"],
        commandOptions: ["--policy", "always"],
        env,
      });
    } else {
      const commandOptions = [];

      if (this.config.processEnv.DOCKER_BUILDER) {
        commandOptions.push("--builder", this.config.processEnv.DOCKER_BUILDER);
      }

      if (this.config.processEnv.DOCKER_PUSH) {
        commandOptions.push("--push");
      }

      await compose.buildOne("base", {
        log: true,
        config: ["docker/docker-compose.build.yml"],
        commandOptions,
        env,
      });
    }
  }
}
