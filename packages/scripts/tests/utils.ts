import { tmpfile, dotenv } from "zx";

import { DockerTag } from "../src/docker-tag";
import { Runner, Script } from "../src/lib";

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
  const runner = new Runner(config);
  return runner.run(script);
}
