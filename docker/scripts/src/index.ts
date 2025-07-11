import { minimist, chalk } from "zx";

import { Runner, createConfig, Logger, type Config } from "./lib.js";
import { Environment } from "./parse-env.js";
import process from "node:process";

const scriptModules = import.meta.glob("./scripts/*", { eager: true });

const scripts: Record<string, unknown> = {};
for (const [path, module] of Object.entries(scriptModules)) {
  const name = path.split("/").pop()?.replace(".ts", "");
  if (name) {
    scripts[name] = module;
  }
}

function printHelp(message: string, exitCode = 1): never {
  const color = exitCode === 0 ? chalk.green : chalk.red;
  console.log(color(message));
  console.log(chalk.yellow("Available commands:"));
  console.log(chalk.yellow(Object.keys(scripts).join("\n")));
  return process.exit(exitCode);
}

export default async function main(
  _argv: string[],
  _env: Record<string, string>,
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

  let command: string = args._[0] || "";

  if (!scripts[command]) {
    command = "index";
  }

  const { default: ScriptClass } = scripts[command];
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
