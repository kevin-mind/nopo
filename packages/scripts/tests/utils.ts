import { tmpfile, dotenv } from "zx";

import { DockerTag } from "../src/docker-tag";
import { Runner, Script, Logger } from "../src/lib";
import { Environment } from "../src/parse-env";

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

export function runScript(script: typeof Script, config) {
  const logger = new Logger(config);
  const environment = new Environment(config);
  const runner = new Runner(config, environment, logger);
  return runner.run(script);
}
