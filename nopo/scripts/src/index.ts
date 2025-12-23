import {
  Runner,
  createConfig,
  Logger,
  type Config,
  type Script,
  minimist,
  chalk,
} from "./lib.ts";
import { Environment } from "./parse-env.ts";
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

function printNopoHeader(): void {
  const asciiArt = `
███╗   ██╗ ██████╗ ██████╗  ██████╗ 
████╗  ██║██╔═══██╗██╔══██╗██╔═══██╗
██╔██╗ ██║██║   ██║██████╔╝██║   ██║
██║╚██╗██║██║   ██║██╔═══╝ ██║   ██║
██║ ╚████║╚██████╔╝██║     ╚██████╔╝
╚═╝  ╚═══╝ ╚═════╝ ╚═╝      ╚═════╝ 
`;
  console.log(chalk.cyan(asciiArt));
}

function printCommandsTable(): void {
  const commands = Object.entries(scripts)
    .map(([key, ScriptClass]) => ({
      name: ScriptClass.name || key,
      description: ScriptClass.description || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const nameWidth = Math.max(
    ...commands.map((cmd) => cmd.name.length),
    "COMMAND".length,
  );
  const descriptionWidth = Math.max(
    ...commands.map((cmd) => cmd.description.length),
    "DESCRIPTION".length,
  );

  const commandHeader = "COMMAND".padEnd(nameWidth);
  const descriptionHeader = "DESCRIPTION".padEnd(descriptionWidth);
  const header = chalk.cyan(
    chalk.bold(`  ${commandHeader}  ${descriptionHeader}`),
  );
  const separator = chalk.gray(
    `  ${"-".repeat(nameWidth)}  ${"-".repeat(descriptionWidth)}`,
  );

  console.log(header);
  console.log(separator);

  for (const cmd of commands) {
    const name = chalk.yellow(cmd.name.padEnd(nameWidth));
    const description = chalk.white(cmd.description.padEnd(descriptionWidth));
    console.log(`  ${name}  ${description}`);
  }
}

function printHelp(message: string, exitCode = 1): never {
  printNopoHeader();
  const color = exitCode === 0 ? chalk.green : chalk.red;
  console.log(color(message));
  console.log();
  printCommandsTable();
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

  if (!args._[0]) {
    printNopoHeader();
    console.log(chalk.cyan(chalk.bold("Available commands:\n")));
    printCommandsTable();
    return process.exit(0);
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
