import compose from "docker-compose";

import {
  TargetScript,
  type ScriptDependency,
  type Runner,
  createLogger,
  exec,
} from "../lib.ts";
import EnvScript from "./env.ts";
import BuildScript from "./build.ts";
import PullScript from "./pull.ts";
import { baseArgs } from "../args.ts";
import type { ScriptArgs } from "../script-args.ts";

export function isBuild({ config, environment }: Runner): boolean {
  const forceBuild = !!config.processEnv.DOCKER_BUILD;
  const localVersion = environment.env.DOCKER_VERSION === "local";
  return forceBuild || localVersion;
}

export function isPull(runner: Runner): boolean {
  return !isBuild(runner);
}

export default class UpScript extends TargetScript {
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
      // Pass targets from UpScript to PullScript
      args: (parentArgs) => ({
        targets: parentArgs.get("targets"),
      }),
    },
  ];

  static override args = baseArgs.extend({});

  override async fn(args: ScriptArgs) {
    if (!this.runner.environment.env.DOCKER_TAG) {
      throw new Error("DOCKER_TAG is required but was empty");
    }

    const isProduction =
      this.runner.environment.env.DOCKER_TARGET === "production";

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

    // Try offline sync first (fast), fall back to online if cache is empty.
    // Sync is only needed in dev mode where host source is bind-mounted.
    const uvSync = async () => {
      if (isProduction) return;
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
      if (isProduction) return;
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

    // In production mode, run each buildable service's build command inside
    // Docker so built files land on the host via the bind mount.
    const buildSync = async () => {
      if (!isProduction) return;
      const services = this.runner.config.project.services.entries;
      for (const [id, service] of Object.entries(services)) {
        if (!service.build?.command || !service.runtime) continue;
        if (!(id in data.config.services)) continue;

        const buildEnv = { CI: "true", ...service.build.env };
        const envFlags = Object.entries(buildEnv).flatMap(([key, value]) => [
          "-e",
          `${key}=${value}`,
        ]);

        this.log(`Building ${id} in production mode...`);
        await compose.run(id, ["sh", "-c", service.build.command], {
          callback: createLogger(`build:${id}`, "cyan"),
          commandOptions: [
            "--rm",
            "--no-deps",
            "--remove-orphans",
            ...envFlags,
          ],
          env: this.env,
        });
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

    // buildSync runs after down/pull so the Docker network exists for compose.run.
    await buildSync();

    // Docker build commands install Linux-specific native packages (e.g. rollup)
    // into node_modules via the bind mount. Restore host-compatible packages.
    if (isProduction) {
      this.log("Restoring host node_modules after Docker build...");
      await exec("pnpm", ["install", "--frozen-lockfile"], {
        cwd: this.runner.config.root,
        env: { ...this.env, CI: "true" },
        verbose: true,
      });
    }

    const targets = args.get<string[]>("targets") ?? [];

    try {
      if (targets.length > 0) {
        await compose.upMany(targets, {
          callback: createLogger("up"),
          commandOptions: ["--remove-orphans", "-d", "--no-build", "--wait"],
          env: this.env,
        });
      } else {
        await compose.upAll({
          callback: createLogger("up"),
          commandOptions: ["--remove-orphans", "-d", "--no-build", "--wait"],
          env: this.env,
        });
      }
    } catch (error) {
      const servicesToLog =
        targets.length > 0 ? targets : Object.keys(data.config.services);
      await Promise.all(
        servicesToLog.map((service: string) =>
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
