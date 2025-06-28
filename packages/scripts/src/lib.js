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

export class Logger {
  constructor(config) {
    chalk.level = 2;
    this.config = config;
  }

  get chalk() {
    return chalk;
  }

  log(...args) {
    if (this.config.silent) return;
    console.log(...args);
  }
}

export class Script {
  static name = "";
  static description = "";
  static dependencies = [];

  constructor(runner) {
    this.runner = runner;
  }

  async fn() {
    throw new Error("Not implemented");
  }

  get exec() {
    const shell = $({
      cwd: this.runner.config.root,
      stdio: "inherit",
      verbose: true,
      env: {
        ...this.runner.environment.processEnv,
        ...this.runner.environment.env,
      },
    });

    return shell;
  }

  log(...message) {
    this.runner.logger.log(this.runner.logger.chalk.yellow(...message, "\n"));
  }
}

export class Runner {
  constructor(config, environment, logger = new Logger(config)) {
    this.config = config;
    this.environment = environment;
    this.logger = logger;
  }

  resolveDependencies(scriptClass, dependencies = new Map()) {
    if (scriptClass.dependencies.length === 0) {
      dependencies.set(scriptClass, true);
      return dependencies;
    }

    for (const dep of scriptClass.dependencies) {
      let enabled = true;
      if (typeof dep.enabled === "function") {
        enabled = dep.enabled(this);
      } else {
        enabled = dep.enabled;
      }

      dependencies.set(dep.class, enabled);

      if (enabled) {
        this.resolveDependencies(dep.class, dependencies);
      }
    }

    dependencies.set(scriptClass, true);
    return dependencies;
  }

  async run(ScriptClass) {
    const scripts = this.resolveDependencies(ScriptClass);
    const line = (length) =>
      `${Array(Math.round(length * 1.618))
        .fill("=")
        .join("")}`;
    for await (const [ScriptToRun, enabled] of scripts) {
      const skipped = enabled ? "" : chalk.bold("(skipped)");
      const color = enabled ? chalk.magenta : chalk.yellow;
      const message = `${chalk.bold(ScriptToRun.name)}: ${ScriptToRun.description} ${skipped}`;
      const length = message.length + 2;
      this.logger.log(color([line(length), message, line(length)].join("\n")));
      if (!enabled) continue;
      const scriptInstance = new ScriptToRun(this);
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
