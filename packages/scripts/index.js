import { minimist, chalk, glob } from "zx";

import { Runner } from "./src/lib.js";
import createConfig from "./src/config.js";

const scripts = glob.sync("./src/scripts/*.js").reduce((acc, path) => {
  const name = path.split("/").pop().split(".").shift();
  acc[name] = path;
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

  const command = args._[0];

  if (!command) {
    return printHelp("No script provided", 1);
  }

  const scriptPath = scripts[command];
  if (!scriptPath) {
    return printHelp(`Command ${command} not found.`, 1);
  }

  const { default: script } = await import(scriptPath);
  const config = createConfig({});

  const runner = new Runner(config);
  await runner.run(script);
}

main();
