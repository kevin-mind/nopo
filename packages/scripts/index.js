import { minimist, chalk, $ } from "zx";

import env from "./src/scripts/env.js";
import status from "./src/scripts/status.js";
import up from "./src/scripts/up.js";

import config from "./src/config.js";

$.cwd = config.root;

const availableScripts = {
  env,
  status,
  up,
};

function printHelp(message, exitCode = 1) {
  const color = exitCode === 0 ? chalk.green : chalk.red;
  console.log(color(message));
  console.log(chalk.yellow("Available commands:"));
  console.log(chalk.yellow(Object.keys(availableScripts).join("\n")));
  return process.exit(exitCode);
}

export default async function main() {
  const args = minimist(process.argv.slice(2));

  if (args.help) {
    return printHelp("Usage: @more/scripts <command> [options]", 0);
  }

  const command = args._[0];

  if (!command) {
    return printHelp("No script provided", 1);
  }

  const script = availableScripts[command];

  if (!script) {
    return printHelp(`Command ${command} not found.`, 1);
  }

  if (!script || typeof script !== "function") {
    console.error(`Command ${command} is not a function`);
    process.exit(1);
  }

  script(config);
}

main();
