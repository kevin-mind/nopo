import { Script, type ScriptDependency } from "../lib.js";
import EnvScript from "./env.js";

export default class PullScript extends Script {
  static override name = "pull";
  static override description = "Pull the base image";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  override async fn() {
    this.log(`Pulling image: ${this.runner.environment.env.DOCKER_TAG}`);
    await this
      .exec`docker compose -f docker/docker-compose.base.yml pull base --policy always`;
  }
}
