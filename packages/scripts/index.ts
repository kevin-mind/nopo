#!/usr/bin/env node

import { minimist, chalk, glob } from "zx";
import path from "node:path";

import { Runner, Config } from "./src/lib.ts";

const basePath = import.meta.dirname;
const scriptsPath = path.join(basePath, "src", "scripts");

const scripts = glob
  .sync(path.join(scriptsPath, "*.ts"))
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
  const args = minimist(process.argv.slice(2));

  if (args.help) {
    return printHelp("Usage: @more/scripts <command> [options]", 0);
  }

  let command = args._[0];
  const processEnv = { ...process.env };

  if (!command) {
    command = "run";
  }

  let scriptPath = scripts[command];

  if (!scriptPath) {
    scriptPath = scripts["run"];
    processEnv.DOCKER_RUN = command;
  }

  const { ENV_FILE = undefined } = process.env;

  const { default: script } = await import(scriptPath);
  const config = new Config({ envFile: ENV_FILE, processEnv });

  const runner = new Runner(config);
  await runner.run(script);
}

main();
