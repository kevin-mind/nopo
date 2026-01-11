import path from "node:path";
import { fileURLToPath } from "node:url";
import { DockerTag } from "../src/docker-tag.ts";
import {
  Runner,
  Script,
  Logger,
  createConfig,
  tmpfile,
  dotenv,
} from "../src/lib.ts";
import { Environment } from "../src/parse-env.ts";

// Project root is 3 levels up from this file (tests/utils.ts -> scripts -> nopo -> project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
// Fixtures root is 2 levels up from this file then into nopo/fixtures
export const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures");

export function createTestConfig(options: Parameters<typeof createConfig>[0] = {}) {
  return createConfig({
    rootDir: PROJECT_ROOT,
    ...options,
  });
}

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
  argv: string[] = [],
) {
  const logger = new Logger(config);
  const environment = new Environment(config);
  const runner = new Runner(config, environment, argv, logger);
  return runner.run(script);
}
