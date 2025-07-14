import compose from "docker-compose";

import { Script, type ScriptDependency } from "../lib.ts";
import { isInContainer, createLogger } from "../utils.ts";

export default class SyncScript extends Script {
  static override name = "sync";
  static override description = "Sync the services";
  static override dependencies: ScriptDependency[] = [];

  override async fn(): Promise<void> {
    const pnpmInstall = ["pnpm", "install", "--frozen-lockfile"];
    const uvInstall = ["uv", "sync", "--locked", "--verbose"];
    const workspaceBuild = "pnpm run -r build";

    this.log(
      `Syncing services... ${isInContainer() ? "in container" : "on host"}`,
    );

    await this.exec`rm -rf .venv node_modules`;

    // Actually we should make UP call this script and make it run in a container.

    if (isInContainer()) {
      await Promise.all([this.exec`${pnpmInstall}`, this.exec`${uvInstall}`]);
      if (this.env.DOCKER_TARGET === "production") {
        await this.exec`${workspaceBuild}`;
      }
    } else {
      await Promise.all([
        compose.run("base", pnpmInstall, {
          callback: createLogger("sync:pnpm"),
          commandOptions: ["--rm", "--remove-orphans"],
          env: this.env,
        }),
        compose.run("base", uvInstall, {
          callback: createLogger("sync:uv"),
          commandOptions: ["--rm", "--remove-orphans"],
          env: this.env,
        }),
      ]);
      if (this.env.DOCKER_TARGET === "production") {
        await compose.run("base", workspaceBuild, {
          callback: createLogger("sync:build"),
          commandOptions: ["--rm", "--remove-orphans"],
          env: this.env,
        });
      }
    }
  }
}
