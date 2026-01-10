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
import { loadProjectConfig } from "./config/index.ts";
import process from "node:process";

import Build from "./scripts/build.ts";
import Command from "./scripts/command.ts";
import Down from "./scripts/down.ts";
import Env from "./scripts/env.ts";
import List from "./scripts/list.ts";
import Pull from "./scripts/pull.ts";
import Run from "./scripts/run.ts";
import Status from "./scripts/status.ts";
import Up from "./scripts/up.ts";

const scripts: Record<string, typeof Script> = {
  build: Build,
  command: Command,
  down: Down,
  env: Env,
  list: List,
  pull: Pull,
  run: Run,
  status: Status,
  up: Up,
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

function printServiceCommandsTable(): void {
  try {
    const project = loadProjectConfig(process.cwd());
    const services = project.services.targets;

    // Build a tree structure of commands
    interface CommandNode {
      services: Set<string>;
      children: Map<string, CommandNode>;
    }

    const commandTree = new Map<string, CommandNode>();

    // Recursively collect commands into tree structure
    function collectCommands(
      serviceId: string,
      commands: Record<string, any>,
      parentNode: Map<string, CommandNode>,
    ): void {
      for (const [commandName, command] of Object.entries(commands)) {
        if (!parentNode.has(commandName)) {
          parentNode.set(commandName, {
            services: new Set(),
            children: new Map(),
          });
        }
        const node = parentNode.get(commandName)!;
        node.services.add(serviceId);

        // Recursively collect sub-commands
        if (command.commands) {
          collectCommands(serviceId, command.commands, node.children);
        }
      }
    }

    for (const serviceId of services) {
      const service = project.services.entries[serviceId];
      if (!service) continue;

      collectCommands(serviceId, service.commands, commandTree);
    }

    if (commandTree.size === 0) {
      return; // No commands to display
    }

    console.log(chalk.cyan(chalk.bold("\nService Commands:\n")));

    const commandHeader = "COMMAND";
    const servicesHeader = "SERVICES";
    const header = chalk.cyan(chalk.bold(`  ${commandHeader.padEnd(25)}  ${servicesHeader}`));
    const separator = chalk.gray(`  ${"-".repeat(25)}  ${"-".repeat(40)}`);

    console.log(header);
    console.log(separator);

    // Print tree recursively
    function printCommandNode(
      name: string,
      node: CommandNode,
      prefix: string,
      isLast: boolean,
      depth: number,
    ): void {
      // Create the tree branch characters
      const branch = isLast ? "└─ " : "├─ ";
      const indent = depth === 0 ? "" : prefix + branch;

      const displayName = indent + name;
      const servicesList = Array.from(node.services)
        .sort()
        .map((s) => chalk.green(s))
        .join(chalk.gray(", "));

      const nameColor = depth === 0 ? chalk.yellow : chalk.cyan;
      console.log(`  ${nameColor(displayName.padEnd(25))}  ${servicesList}`);

      // Print children
      if (node.children.size > 0) {
        const childEntries = Array.from(node.children.entries()).sort((a, b) =>
          a[0].localeCompare(b[0]),
        );

        const childPrefix = depth === 0 ? "" : prefix + (isLast ? "   " : "│  ");

        childEntries.forEach(([childName, childNode], index) => {
          const isLastChild = index === childEntries.length - 1;
          printCommandNode(
            childName,
            childNode,
            childPrefix,
            isLastChild,
            depth + 1,
          );
        });
      }
    }

    // Sort and print top-level commands
    const sortedCommands = Array.from(commandTree.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    sortedCommands.forEach(([name, node], index) => {
      const isLast = index === sortedCommands.length - 1;
      printCommandNode(name, node, "", isLast, 0);
    });
  } catch (error) {
    // Silently skip if we can't load the project config
    // This can happen if nopo.yml doesn't exist or is invalid
  }
}

function printCommandHelp(
  ScriptClass: typeof Script,
  commandName: string,
): never {
  printNopoHeader();
  const name = ScriptClass.name || commandName;
  const description = ScriptClass.description || "";

  console.log(chalk.cyan(chalk.bold(`\nCommand: ${chalk.yellow(name)}\n`)));
  if (description) {
    console.log(chalk.white(`  ${description}\n`));
  }
  console.log(chalk.gray(`  Usage: nopo ${name} [options]\n`));
  return process.exit(0);
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
  const argv = _argv.slice(2);
  const args = minimist(argv);

  // Check if this is a command that outputs machine-readable format and should be silent
  const commandName = args._[0] || "";
  const isJsonOutput =
    commandName === "list" &&
    !!(args.json || args.j || args.format === "json" || args.f === "json");
  const isCsvOutput =
    commandName === "list" &&
    !!(args.csv || args.format === "csv" || args.f === "csv");
  const isSilentOutput = isJsonOutput || isCsvOutput;

  const config: Config = createConfig({
    envFile: _env.ENV_FILE || undefined,
    silent: isSilentOutput,
    rootDir: _env.ROOT_DIR || undefined,
  });
  const logger = new Logger(config);
  const environment = new Environment(config);
  const runner = new Runner(config, environment, argv, logger);

  // Show general help only if --help is passed without a command
  if (args.help && !args._[0]) {
    return printHelp("Usage: nopo <command> [options]", 0);
  }

  if (!args._[0]) {
    printNopoHeader();
    console.log(chalk.cyan(chalk.bold("Available commands:\n")));
    printCommandsTable();
    printServiceCommandsTable();
    return process.exit(0);
  }

  // Handle "help" as a special command (show general help)
  if (commandName === "help") {
    return printHelp("Usage: nopo <command> [options]", 0);
  }

  // Determine which script to use
  // Priority: always use registered scripts first if they exist
  // Only fall back to Command script if no registered script matches
  const ScriptClass = scripts[commandName] ?? Command;

  // Check for recursive help: nopo <command> help or nopo <command> --help
  if (args._[1] === "help" || args.help) {
    return printCommandHelp(ScriptClass, commandName);
  }

  try {
    await runner.run(ScriptClass);
  } catch (error) {
    if (error instanceof Error) {
      runner.logger.log(chalk.red(`\n${error.message}\n`));
      if (error.stack) {
        runner.logger.log(chalk.gray(error.stack));
      }
    } else if (error && typeof error === "object" && "err" in error) {
      runner.logger.log(chalk.red(`\n${error.err}\n`));
    } else {
      runner.logger.log(chalk.red(`\nUnknown error: ${String(error)}\n`));
    }
    process.exit(1);
  }
}
