import { Script, type ScriptDependency } from "../lib.js";
import { isInContainer } from "../utils.ts";
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

  override async fn(): Promise<void> {
    if (isInContainer()) {
      return this.log("Running in container, skipping pull");
    }

    this.log(`Pulling image: ${this.runner.environment.env.DOCKER_TAG}`);
    await this
      .exec`docker compose -f docker/docker-compose.base.yml pull base --policy always`;
  }
}
