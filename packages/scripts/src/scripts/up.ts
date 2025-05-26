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
    const { env } = new ParseEnv(this.config.envFile);
    const { data } = await compose.config({
      cwd: this.config.root,
      env: {
        ...this.config.processEnv,
        ...env,
      },
    });
    const downServices = [];

    for (const [name, service] of Object.entries(data.config.services)) {
      if (typeof service === "string") continue;
      if (service.image !== env.DOCKER_TAG) continue;
      downServices.push(name);
    }

    await compose.downMany(downServices, {
      log: true,
      commandOptions: ["--remove-orphans"],
    });

    await compose.upAll({
      log: true,
      commandOptions: ["--remove-orphans", "-d", "--no-build"],
    });
    await compose.rm({
      log: true,
      commandOptions: ["--force"],
    });
  }
}
