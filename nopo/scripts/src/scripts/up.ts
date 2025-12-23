import compose from "docker-compose";

import {
  Script,
  type ScriptDependency,
  type Runner,
  createLogger,
} from "../lib.ts";
import EnvScript from "./env.ts";
import BuildScript from "./build.ts";
import PullScript from "./pull.ts";

export function isBuild({ config, environment }: Runner): boolean {
  const forceBuild = !!config.processEnv.DOCKER_BUILD;
  const localVersion = environment.env.DOCKER_VERSION === "local";
  return forceBuild || localVersion;
}

export function isPull(runner: Runner): boolean {
  return !isBuild(runner);
}

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
  ];

  override async fn() {
    if (!this.runner.environment.env.DOCKER_TAG) {
      throw new Error("DOCKER_TAG is required but was empty");
    }
    const { data } = await compose.config({
      cwd: this.runner.config.root,
      env: this.env,
    });
    const downServices: string[] = [];

    for (const [name, service] of Object.entries(data.config.services)) {
      if (typeof service === "string") continue;
      if (service.image !== this.runner.environment.env.DOCKER_TAG) continue;
      downServices.push(name);
    }

    // Try offline sync first (fast), fall back to online if cache is empty
    const uvSync = async () => {
      try {
        await compose.run(
          "base",
          ["uv", "sync", "--locked", "--active", "--offline"],
          {
            callback: createLogger("sync_uv", "green"),
            commandOptions: ["--rm", "--no-deps", "--remove-orphans"],
            env: this.env,
          },
        );
      } catch {
        this.log("Offline uv sync failed, falling back to online sync...");
        await compose.run("base", ["uv", "sync", "--locked", "--active"], {
          callback: createLogger("sync_uv", "green"),
          commandOptions: ["--rm", "--no-deps", "--remove-orphans"],
          env: this.env,
        });
      }
    };

    const pnpmSync = async () => {
      try {
        await compose.run(
          "base",
          ["sh", "-c", "yes | pnpm install --frozen-lockfile --offline"],
          {
            callback: createLogger("sync_pnpm", "blue"),
            commandOptions: ["--rm", "--no-deps", "--remove-orphans"],
            env: this.env,
          },
        );
      } catch {
        this.log(
          "Offline pnpm install failed, falling back to online install...",
        );
        await compose.run(
          "base",
          ["sh", "-c", "yes | pnpm install --frozen-lockfile"],
          {
            callback: createLogger("sync_pnpm", "blue"),
            commandOptions: ["--rm", "--no-deps", "--remove-orphans"],
            env: this.env,
          },
        );
      }
    };

    await Promise.all([
      uvSync(),
      pnpmSync(),
      compose.downMany(downServices, {
        callback: createLogger("down", "yellow"),
        commandOptions: ["--remove-orphans"],
        env: this.env,
      }),
      compose.pullAll({
        callback: createLogger("pull", "blue"),
        commandOptions: ["--ignore-pull-failures"],
        env: this.env,
      }),
    ]);

    if (this.runner.environment.env.DOCKER_TARGET === "production") {
      this.log("Building packages...");
      await compose.run("base", ["pnpm", "-r", "build"], {
        callback: createLogger("build", "green"),
        commandOptions: ["--rm", "--no-deps", "--remove-orphans"],
        env: this.env,
      });
    }

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

    const port = this.runner.environment.env.DOCKER_PORT;
    this.log(`\n🚀 Services are up! Visit: http://localhost:${port}\n`);
  }
}
