import { path, chalk, $, ProcessOutput } from "zx";
import { fileURLToPath } from "node:url";

export class Config {
  __filename: string = fileURLToPath(import.meta.url);
  __dirname: string = path.dirname(this.__filename);
  root: string = path.resolve(this.__dirname, "..", "..", "..");
  envFile: string = path.resolve(this.root, ".env");
  processEnv: NodeJS.ProcessEnv = { ...process.env };
  silent: boolean = false;

  constructor(
    overrides: Partial<Pick<Config, "envFile" | "processEnv" | "silent">> = {},
  ) {
    chalk.level = 2;
    $.cwd = this.root;
    Object.assign(this, overrides);
  }
}

class Logger {
  config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  log(...args: unknown[]) {
    if (this.config.silent) return;
    console.log(...args);
  }
}

class Base {
  config: Config;
  logger: Logger;

  constructor(config: Config, logger: Logger = new Logger(config)) {
    this.config = config;
    this.logger = logger;
  }
}

export class Script extends Base {
  static name: string;
  static description: string;
  static dependencies: (typeof Script)[] = [];

  async fn() {
    throw new Error("Not implemented");
  }
}

export class Runner extends Base {
  resolveDependencies<T extends typeof Script>(
    scriptClass: T,
    seen: Set<T> = new Set(),
  ) {
    if (scriptClass.dependencies.length === 0) {
      seen.add(scriptClass);
      return seen;
    }

    for (const dep of scriptClass.dependencies) {
      this.resolveDependencies(dep, seen);
    }

    seen.add(scriptClass);
    return seen;
  }

  async run(ScriptClass: typeof Script) {
    const scripts = this.resolveDependencies(ScriptClass);
    const line = `\n${Array(80).fill("=").join("")}\n`;
    for await (const ScriptToRun of scripts) {
      this.logger.log(
        chalk.magenta(
          line,
          `${chalk.bold(ScriptToRun.name)}: ${ScriptToRun.description}`,
          line,
        ),
      );
      const scriptInstance = new ScriptToRun(this.config, this.logger);
      try {
        await scriptInstance.fn();
      } catch (error) {
        if (error instanceof ProcessOutput) {
          this.logger.log(chalk.red(error.stdout));
          this.logger.log(chalk.red(error.stderr));
          this.logger.log(error.stack);
          process.exit(error.exitCode);
        }
        throw error;
      }
    }
  }
}
