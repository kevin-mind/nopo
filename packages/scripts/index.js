#!/usr/bin/env zx

import { minimist, chalk, glob } from "zx";
import path from "node:path";

import { Runner, createConfig, Logger } from "./src/lib.js";
import { Environment } from "./src/parse-env.js";

const basePath = import.meta.dirname;
const scriptsPath = path.join(basePath, "src", "scripts");

const scripts = glob
  .sync(path.join(scriptsPath, "*.js"))
  .reduce((acc, path) => {
    const name = path.split("/").pop()?.split(".").shift();
    if (name) {
      acc[name] = path;
    }
    return acc;
  }, {});

function printHelp(message, exitCode = 1) {
  const color = exitCode === 0 ? chalk.green : chalk.red;
  console.log(color(message));
  console.log(chalk.yellow("Available commands:"));
  console.log(chalk.yellow(Object.keys(scripts).join("\n")));
  return process.exit(exitCode);
}

export default async function main() {
  const config = createConfig({ envFile: process.env.ENV_FILE });
  const logger = new Logger(config);
  const environment = new Environment(config);
  const argv = process.argv.slice(2);
  const args = minimist(argv);
  const runner = new Runner(config, environment, argv.slice(2), logger);

  if (args.help) {
    return printHelp("Usage: @more/scripts <command> [options]", 0);
  }

  let command = args._[0];

  if (!scripts[command]) {
    command = "index";
  }

  let scriptPath = scripts[command];

  if (!scriptPath) {
    return printHelp(`Command not found: ${command}`, 1);
  }

  const { default: script } = await import(scriptPath);

  try {
    await runner.run(script);
  } catch (error) {
    if (error instanceof Error) {
      runner.logger.log(chalk.red(`\n${error.message}\n`, error.stack));
    }
    process.exit(1);
  }
}

main();
