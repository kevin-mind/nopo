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
      this.logger.log("Building base image");
      await compose.buildOne("base", {
        log: true,
        config: [
          "docker/docker-compose.base.yml",
          "docker/docker-compose.build.yml",
        ],
        env,
      });
    }
  }
}
