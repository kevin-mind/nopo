import compose from "docker-compose";
import { Script } from "../lib.js";
import EnvScript from "./env.js";

import { ParseEnv } from "../parse-env.js";

export default class ImageScript extends Script {
  static name = "image";
  static description = "Build or pull the base image";
  static dependencies = [EnvScript];

  async fn() {
    const { env } = new ParseEnv(this.config.envFile);
    if (env.DOCKER_REGISTRY) {
      await compose.pullOne("base", {
        log: true,
        commandOptions: ["--policy", "always"],
      });
    } else {
      await compose.buildOne("base", {
        log: true,
        cwd: this.config.root,
        env: {
          ...this.config.processEnv,
          ...env,
          COMPOSE_BAKE: "true",
        },
      });
    }
  }
}
