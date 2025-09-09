import { minimist, chalk } from "zx";

import {
  Runner,
  createConfig,
  Logger,
  type Config,
  type Script,
} from "./lib.js";
import { Environment } from "./parse-env.js";
import process from "node:process";

import Build from "./scripts/build.ts";
import Env from "./scripts/env.ts";
import Index from "./scripts/index.ts";
import Pull from "./scripts/pull.ts";
import Status from "./scripts/status.ts";
import Up from "./scripts/up.ts";
import Down from "./scripts/down.ts";

const scripts: Record<string, typeof Script> = {
  build: Build,
  env: Env,
  index: Index,
  pull: Pull,
  status: Status,
  up: Up,
  down: Down,
};

function printHelp(message: string, exitCode = 1): never {
  const color = exitCode === 0 ? chalk.green : chalk.red;
  console.log(color(message));
  console.log(chalk.yellow("Available commands:"));
  console.log(chalk.yellow(Object.keys(scripts).join("\n")));
  return process.exit(exitCode);
}

export default async function main(
  _argv: string[] = process.argv,
  _env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config: Config = createConfig({
    envFile: _env.ENV_FILE || undefined,
  });
  const logger = new Logger(config);
  const environment = new Environment(config);
  const argv = _argv.slice(2);
  const args = minimist(argv);
  const runner = new Runner(config, environment, argv, logger);

  if (args.help) {
    return printHelp("Usage: nopo <command> [options]", 0);
  }

  const ScriptClass = scripts[args._[0] || ""] ?? Index;

  try {
    await runner.run(ScriptClass);
  } catch (error) {
    if (error instanceof Error) {
      runner.logger.log(chalk.red(`\n${error.message}\n`, error.stack));
    } else if (error && typeof error === "object" && "err" in error) {
      runner.logger.log(chalk.red(`\n${error.err}\n`));
    }
    throw error;
  }
}
