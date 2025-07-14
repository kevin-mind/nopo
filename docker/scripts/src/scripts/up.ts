import compose from "docker-compose";

import { Script, type ScriptDependency } from "../lib.js";
import { isBuild, isPull, isInContainer, createLogger } from "../utils.js";
import EnvScript from "./env.js";
import BuildScript from "./build.js";
import PullScript from "./pull.js";
import SyncScript from "./sync.ts";

export default class UpScript extends Script {
  static override name = "up";
  static override description = "Start the services";
  static override dependencies: ScriptDependency[] = [
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
    {
      class: SyncScript,
      enabled: true,
    },
  ];

  override async fn(): Promise<void> {
    if (isInContainer()) {
      return this.log("Running in container, skipping up");
    }

    const { data } = await compose.config({
      cwd: this.runner.config.root,
      env: this.env,
    });

    try {
      await compose.upAll({
        callback: createLogger("up"),
        commandOptions: ["--remove-orphans", "-d", "--no-build", "--wait"],
        env: this.env,
      });
    } catch (error) {
      await Promise.all(
        Object.keys(data.config.services).map((service) =>
          compose.logs(service, {
            callback: createLogger(`log:${service}`),
            commandOptions: ["--no-log-prefix"],
            env: this.env,
          }),
        ),
      );
      throw new Error("Failed to start services", { cause: error });
    }
  }
}
