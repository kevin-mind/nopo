import { dotenv, tempdir } from "zx";
import fs from "node:fs";

import { DockerTag } from "../src/docker-tag.ts";
import {
  Runner,
  Logger,
  createConfig,
  type Config,
  type CreateConfigOptions,
  Script,
} from "../src/lib.ts";
import { Environment, type SchemaTypePartial } from "../src/parse-env.ts";

export const dockerTag = new DockerTag({
  registry: "docker.io",
  image: "org/repo",
  version: "sha-123abc",
  digest:
    "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
});

export function createTestEnv(config: Config, env: SchemaTypePartial = {}) {
  fs.writeFileSync(config.envFile, dotenv.stringify(env));
  return env;
}

export function createTestConfig(options: CreateConfigOptions = {}) {
  const { root = tempdir(), silent = true, ...rest } = options;
  return createConfig({
    root,
    silent,
    ...rest,
  });
}

export function runScript(script: typeof Script, config: Config) {
  const logger = new Logger(config);
  const environment = new Environment(config);
  const runner = new Runner(config, environment, [], logger);
  return runner.run(script);
}
