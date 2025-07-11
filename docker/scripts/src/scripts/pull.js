import { Script } from "../lib.js";
import EnvScript from "./env.js";

export default class PullScript extends Script {
  static name = "pull";
  static description = "Pull the base image";
  static dependencies = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  async fn() {
    this.log(`Pulling image: ${this.runner.environment.env.DOCKER_TAG}`);
    await this
      .exec`docker compose -f docker/docker-compose.base.yml pull base --policy always`;
  }
}
