import { path, chalk, $, ProcessOutput } from "zx";
import { z } from "zod";
import { fileURLToPath } from "node:url";

const ConfigSchema = z.object({
  root: z.string(),
  envFile: z.string(),
  processEnv: z.record(z.string(), z.string()),
  silent: z.boolean(),
});

export type Config = z.infer<typeof ConfigSchema>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..", "..");

interface CreateConfigOptions {
  envFile?: string | undefined;
  processEnv?: Record<string, string>;
  silent?: boolean;
}

export function createConfig(options: CreateConfigOptions = {}): Config {
  const {
    envFile = ".env",
    processEnv = Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined),
    ) as Record<string, string>,
    silent = false,
  } = options;
  return ConfigSchema.parse({
    root,
    envFile: path.resolve(root, envFile),
    processEnv,
    silent,
  });
}

/**
 * Logger for script output.
 */
export class Logger {
  config: Config;

  constructor(config: Config) {
    chalk.level = 2;
    this.config = config;
  }

  get chalk(): typeof chalk {
    return chalk;
  }

  log(...args: unknown[]): void {
    if (this.config.silent) return;
    console.log(...args);
  }
}

export interface ScriptDependency {
  class: typeof Script;
  enabled: boolean | ((runner: Runner) => boolean | Promise<boolean>);
}

export class Script {
  static name = "";
  static description = "";
  static dependencies: ScriptDependency[] = [];

  runner: Runner;

  constructor(runner: Runner) {
    this.runner = runner;
  }

  async fn(): Promise<void> {
    throw new Error("Not implemented");
  }

  get env(): Record<string, string | undefined> {
    return {
      ...this.runner.environment.processEnv,
      ...this.runner.environment.env,
    };
  }

  get exec() {
    const shell = $({
      cwd: this.runner.config.root,
      stdio: "pipe",
      verbose: true,
      env: this.env,
    });

    return shell;
  }

  log(...message: unknown[]): void {
    this.runner.logger.log(this.runner.logger.chalk.yellow(...message));
  }
}

export class Runner {
  config: Config;
  environment: import("./parse-env.js").Environment;
  logger: Logger;
  argv: string[];

  constructor(
    config: Config,
    environment: import("./parse-env.js").Environment,
    argv: string[] = [],
    logger: Logger = new Logger(config),
  ) {
    this.config = config;
    this.environment = environment;
    this.logger = logger;
    this.argv = argv;
  }

  async isDependencyEnabled(dependency: ScriptDependency): Promise<boolean> {
    return typeof dependency.enabled === "function"
      ? await dependency.enabled(this)
      : dependency.enabled;
  }

  async resolveDependencies(
    ScriptClass: typeof Script,
    dependenciesMap: Map<typeof Script, boolean[]> = new Map(),
  ): Promise<Map<typeof Script, boolean[]>> {
    for await (const dependency of ScriptClass.dependencies) {
      const enabled = await this.isDependencyEnabled(dependency);

      const enabledArr = dependenciesMap.get(dependency.class) || [];
      enabledArr.push(enabled);
      dependenciesMap.set(dependency.class, enabledArr);

      if (enabled) {
        await this.resolveDependencies(dependency.class, dependenciesMap);
      }
    }
    return dependenciesMap;
  }

  async run(ScriptClass: typeof Script): Promise<void> {
    const scripts = await this.resolveDependencies(ScriptClass);
    scripts.set(ScriptClass, [true]);
    const line = (length: number) =>
      `${Array(Math.round(length * 1.618))
        .fill("=")
        .join("")}`;
    for await (const [ScriptToRun, enabledArr] of scripts.entries()) {
      const enabled = enabledArr.some(Boolean);
      const skipped = enabled ? "" : chalk.bold("(skipped)");
      const color = enabled ? chalk.magenta : chalk.gray;
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
