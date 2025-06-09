import { path, chalk, $, ProcessOutput } from "zx";
import { z } from "zod";
import { fileURLToPath } from "node:url";

const Config = z.object({
  root: z.string(),
  envFile: z.string(),
  processEnv: z.record(z.string(), z.string()),
  silent: z.boolean(),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..", "..");

chalk.level = 2;
$.cwd = root;

export function createConfig(options = {}) {
  const {
    envFile = ".env",
    processEnv = { ...process.env },
    silent = false,
  } = options;
  return Config.parse({
    root,
    envFile: path.resolve(root, envFile),
    processEnv,
    silent,
  });
}

class Logger {
  constructor(config) {
    this.config = config;
  }

  log(...args) {
    if (this.config.silent) return;
    console.log(...args);
  }
}

class Base {
  constructor(config, logger = new Logger(config)) {
    this.config = config;
    this.logger = logger;
  }
}

export class Script extends Base {
  static name = "";
  static description = "";
  static dependencies = [];

  async fn() {
    throw new Error("Not implemented");
  }
}

export class Runner extends Base {
  resolveDependencies(scriptClass, seen = new Set()) {
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

  async run(ScriptClass) {
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
