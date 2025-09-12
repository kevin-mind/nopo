import { exec, execSync } from "node:child_process";
import { z } from "zod";
import { chalk } from "./lib.ts";

type Color = "black" | "red" | "blue" | "yellow" | "green";

export function createLogger(name: string, color: Color = "black") {
  return (chunk: Buffer, streamSource?: "stdout" | "stderr"): void => {
    const messages = chunk.toString().trim().split("\n");
    const log = streamSource === "stdout" ? console.log : console.error;
    for (const message of messages) {
      log(chalk[color](`[${name}] ${message}`));
    }
  };
}

export const COMPOSE_CONFIG_SCHEMA = z.object({
  name: z.string(),
  networks: z.record(
    z.union([
      z.object({
        name: z.string(),
        driver: z.string(),
        ipam: z.optional(z.record(z.unknown())),
        enable_ipv6: z.optional(z.boolean()),
      }),
      z.null(),
    ]),
  ),
  services: z.record(
    z.object({
      command: z.optional(z.union([z.array(z.string()), z.string(), z.null()])),
      depends_on: z.optional(
        z.record(
          z.object({
            condition: z.union([
              z.literal("service_healthy"),
              z.literal("service_started"),
            ]),
            required: z.boolean(),
          }),
        ),
      ),
      entrypoint: z.optional(
        z.union([z.array(z.string()), z.string(), z.null()]),
      ),
      environment: z.optional(z.record(z.union([z.string(), z.null()]))),
      healthcheck: z.optional(
        z.object({
          test: z.union([z.array(z.string()), z.string()]),
          timeout: z.optional(z.string()),
          interval: z.optional(z.string()),
          retries: z.optional(z.number()),
          start_period: z.optional(z.string()),
        }),
      ),
      image: z.string(),
      networks: z.optional(z.record(z.unknown())),
      pull_policy: z.optional(z.string()),
      restart: z.optional(z.string()),
      volumes: z.optional(
        z.array(
          z.object({
            type: z.union([z.literal("bind"), z.literal("volume")]),
            source: z.string(),
            target: z.string(),
            bind: z.optional(
              z.object({
                create_host_path: z.optional(z.boolean()),
              }),
            ),
            volume: z.optional(z.record(z.unknown())),
          }),
        ),
      ),
      ports: z.optional(
        z.array(
          z.object({
            mode: z.union([z.literal("ingress"), z.string()]),
            target: z.number(),
            published: z.string(),
            protocol: z.union([z.literal("tcp"), z.string()]),
          }),
        ),
      ),
    }),
  ),
  volumes: z.optional(
    z.record(
      z.object({
        name: z.string(),
      }),
    ),
  ),
});

type DryRun = "--dry-run";
type RemoveOrphans = "--remove-orphans";
type RMI = "--rmi=local" | "--rmi=all";
type Timeout = "--timeout";
type Volumes = "--volumes";

type Command =
  | "down"
  | "up"
  | "config"
  | "ps"
  | "logs"
  | "start"
  | "stop"
  | "restart"
  | "build";

interface DockerComposeOptions<T extends string> {
  callback?: ReturnType<typeof createLogger>;
  commandOptions?: T[];
}

export class DockerCompose {
  cwd = process.cwd();
  env = process.env;

  constructor(cwd?: string, env?: NodeJS.ProcessEnv) {
    if (cwd) this.cwd = cwd;
    if (env) this.env = env;
  }

  private buildCommand(action: Command, args: string[] = []) {
    return ["docker", "compose", action, ...args].join(" ");
  }

  private async exec(
    command: string,
    callback: ReturnType<typeof createLogger> = () => {},
  ) {
    return new Promise((resolve, reject) => {
      const child = exec(command, {
        cwd: this.cwd,
        env: this.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        callback(chunk, "stdout");
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        callback(chunk, "stderr");
      });

      child.on("error", (error: Error) => {
        reject(error);
      });

      child.on("close", (code: number | null) => {
        resolve({
          exitCode: code || 0,
          out: stdout,
          err: stderr,
        });
      });
    });
  }

  get config() {
    const command = this.buildCommand("config", ["--format", "json"]);
    const output = execSync(command, {
      cwd: this.cwd,
      env: this.env,
      encoding: "utf-8",
    });
    const json = JSON.parse(output);
    return COMPOSE_CONFIG_SCHEMA.parse(json);
  }

  get services() {
    return this.config.services ? Object.keys(this.config.services) : [];
  }

  async down(
    services: string[] = [],
    options: DockerComposeOptions<
      DryRun | RemoveOrphans | RMI | Timeout | Volumes
    >,
  ) {
    const command = this.buildCommand("down", [
      ...(services.length ? services : []),
      ...(options.commandOptions || []),
    ]);

    return this.exec(command, options.callback);
  }
}
