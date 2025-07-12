import { tmpfile, dotenv } from "zx";

import { DockerTag } from "../src/docker-tag.ts";
import { Runner, Script, Logger, createConfig } from "../src/lib.ts";
import { Environment } from "../src/parse-env.ts";

export const dockerTag = new DockerTag({
  registry: "docker.io",
  image: "org/repo",
  version: "sha-123abc",
  digest:
    "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
});

export function createTmpEnv(env = {}) {
  const str = dotenv.stringify(env);
  const tmpPath = tmpfile(".env.test", str);
  return tmpPath;
}

export function runScript(
  script: typeof Script,
  config: ReturnType<typeof createConfig>,
) {
  const logger = new Logger(config);
  const environment = new Environment(config);
  const runner = new Runner(config, environment, [], logger);
  return runner.run(script);
}
