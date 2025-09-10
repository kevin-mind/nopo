import path from "node:path";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const ConfigSchema = z.object({
  root: z.string(),
  envFile: z.string(),
  processEnv: z.record(z.string(), z.string()),
  silent: z.boolean(),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Chalk replacement - Simple terminal color utility
// ============================================================================
type ColorLevel = 0 | 1 | 2 | 3;
type ColorArgs = unknown[];
type ColorFunction = (...text: ColorArgs) => string;

interface ChalkInstance {
  level: ColorLevel;
  black: ColorFunction;
  red: ColorFunction;
  green: ColorFunction;
  yellow: ColorFunction;
  blue: ColorFunction;
  magenta: ColorFunction;
  cyan: ColorFunction;
  white: ColorFunction;
  gray: ColorFunction;
  grey: ColorFunction;
  bold: ColorFunction;
  underline: ColorFunction;
}

class Chalk implements ChalkInstance {
  level: ColorLevel = 2;

  private colorize(code: string, ...text: ColorArgs): string {
    if (this.level === 0) return String(text);
    return `\x1b[${code}m${String(text)}\x1b[0m`;
  }

  black = (...text: ColorArgs) => this.colorize("30", ...text);
  red = (...text: ColorArgs) => this.colorize("31", ...text);
  green = (...text: ColorArgs) => this.colorize("32", ...text);
  yellow = (...text: ColorArgs) => this.colorize("33", ...text);
  blue = (...text: ColorArgs) => this.colorize("34", ...text);
  magenta = (...text: ColorArgs) => this.colorize("35", ...text);
  cyan = (...text: ColorArgs) => this.colorize("36", ...text);
  white = (...text: ColorArgs) => this.colorize("37", ...text);
  gray = (...text: ColorArgs) => this.colorize("90", ...text);
  grey = (...text: ColorArgs) => this.colorize("90", ...text);
  bold = (...text: ColorArgs) => this.colorize("1", ...text);
  underline = (...text: ColorArgs) => this.colorize("4", ...text);
}

export const chalk = new Chalk();

// ============================================================================
// Minimist replacement - Simple argument parser
// ============================================================================
export interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | undefined | string[];
}

export function minimist(args: string[]): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (!arg) continue;

    if (arg === "--") {
      result._.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      if (!key) continue;
      if (value !== undefined) {
        result[key] =
          value === "true" ? true : value === "false" ? false : value;
      } else if (i + 1 < args.length && !args[i + 1]?.startsWith("-")) {
        const nextValue = args[i + 1];
        result[key] =
          nextValue === "true"
            ? true
            : nextValue === "false"
              ? false
              : nextValue;
        i++;
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith("-") && !arg.startsWith("--")) {
      const flags = arg.slice(1).split("");
      for (const flag of flags) {
        result[flag] = true;
      }
    } else {
      result._.push(arg);
    }
    i++;
  }

  return result;
}

// ============================================================================
// Dotenv replacement - Parse and stringify .env files
// ============================================================================
export const dotenv = {
  load(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return this.parse(content);
  },

  parse(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const equalIndex = trimmed.indexOf("=");
      if (equalIndex === -1) continue;

      const key = trimmed.slice(0, equalIndex).trim();
      let value = trimmed.slice(equalIndex + 1).trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }

    return result;
  },

  stringify(env: Record<string, string | undefined>): string {
    return Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}="${value}"`)
      .join("\n");
  },
};

// ============================================================================
// Tmpfile replacement - Create temporary files
// ============================================================================
export function tmpfile(filename: string, content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nopo-"));
  const tmpPath = path.join(tmpDir, filename);
  fs.writeFileSync(tmpPath, content);
  return tmpPath;
}

// ============================================================================
// Process execution replacement for $ from zx
// ============================================================================
export class ProcessOutput extends Error {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;

  constructor(
    exitCode: number,
    signal: NodeJS.Signals | null,
    stdout: string,
    stderr: string,
    message?: string,
  ) {
    super(message || `Process exited with code ${exitCode}`);
    this.name = "ProcessOutput";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
    this.combined = stdout + stderr;
  }
}

export interface ProcessPromise extends Promise<ProcessOutput> {
  nothrow(): ProcessPromise;
  pipe(destination: ProcessPromise): ProcessPromise;
  kill(signal?: NodeJS.Signals): void;
  text(): Promise<string>;
}

interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: "pipe" | "inherit";
  verbose?: boolean;
  nothrow?: boolean;
}

class ProcessPromiseImpl implements ProcessPromise {
  private promise: Promise<ProcessOutput>;
  private proc: ReturnType<typeof spawn> | null = null;
  private _nothrow = false;

  constructor(command: string, args: string[], options: ExecOptions = {}) {
    this.promise = new Promise((resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      if (options.verbose) {
        console.log(chalk.gray(`$ ${command} ${args.join(" ")}`));
      }

      const spawnOptions: SpawnOptions = {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: options.stdio || "pipe",
        shell: false,
      };

      this.proc = spawn(command, args, spawnOptions);

      if (this.proc.stdout) {
        this.proc.stdout.on("data", (chunk) => {
          stdout.push(chunk);
          if (options.verbose) {
            process.stdout.write(chunk);
          }
        });
      }

      if (this.proc.stderr) {
        this.proc.stderr.on("data", (chunk) => {
          stderr.push(chunk);
          if (options.verbose) {
            process.stderr.write(chunk);
          }
        });
      }

      this.proc.on("close", (code, signal) => {
        const stdoutStr = Buffer.concat(stdout).toString();
        const stderrStr = Buffer.concat(stderr).toString();
        const output = new ProcessOutput(
          code || 0,
          signal,
          stdoutStr,
          stderrStr,
        );

        if (code !== 0 && !this._nothrow && !options.nothrow) {
          reject(output);
        } else {
          resolve(output);
        }
      });

      this.proc.on("error", (err) => {
        reject(new ProcessOutput(1, null, "", err.message));
      });
    });
  }

  nothrow(): ProcessPromise {
    this._nothrow = true;
    return this;
  }

  pipe(destination: ProcessPromise): ProcessPromise {
    // Simple pipe implementation - would need more work for full compatibility
    return destination;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (this.proc) {
      this.proc.kill(signal);
    }
  }

  then<TResult1 = ProcessOutput, TResult2 = never>(
    onfulfilled?:
      | ((value: ProcessOutput) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<ProcessOutput | TResult> {
    return this.promise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<ProcessOutput> {
    return this.promise.finally(onfinally);
  }

  text() {
    return this.then((output) => output.stdout);
  }

  get [Symbol.toStringTag](): string {
    return "ProcessPromise";
  }
}

// Template literal function for command execution
export function $(options: ExecOptions = {}) {
  return function exec(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): ProcessPromise {
    let command = "";
    for (let i = 0; i < strings.length; i++) {
      command += strings[i];
      if (i < values.length) {
        const value = values[i];
        if (Array.isArray(value)) {
          command += value.join(" ");
        } else {
          command += String(value);
        }
      }
    }

    const parts = command.trim().split(/\s+/);
    const [cmd, ...args] = parts;

    if (!cmd) throw new Error("No command provided");

    return new ProcessPromiseImpl(cmd, args, options);
  };
}

// Synchronous version for $.sync
$.sync = function execSync(
  strings: TemplateStringsArray,
  ...values: unknown[]
): ProcessOutput {
  let command = "";
  for (let i = 0; i < strings.length; i++) {
    command += strings[i];
    if (i < values.length) {
      const value = values[i];
      if (Array.isArray(value)) {
        command += value.join(" ");
      } else {
        command += String(value);
      }
    }
  }

  const parts = command.trim().split(/\s+/);
  const [cmd, ...args] = parts;

  if (!cmd) throw new Error("No command provided");

  try {
    const result = spawnSync(cmd, args, {
      encoding: "utf-8",
      shell: false,
    });

    return new ProcessOutput(
      result.status || 0,
      result.signal,
      result.stdout || "",
      result.stderr || "",
    );
  } catch (error) {
    throw new ProcessOutput(
      1,
      null,
      "",
      error instanceof Error ? error.message : String(error),
    );
  }
};

// ============================================================================
// Original lib.ts code starts here
// ============================================================================
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

type Color = "black" | "red" | "blue" | "yellow" | "green";

export function createLogger(name: string, color: Color = "black") {
  return (chunk: Buffer, streamSource?: "stdout" | "stderr"): void => {
    const messages = chunk.toString().trim().split("\n");
    const log = streamSource === "stdout" ? console.log : console.error;
    for (const message of messages) {
      log(chalk[color](`[${name}] ${message}`));
    }
  };
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

  async fn() {
    throw new Error("Not implemented");
  }

  get env() {
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

  log(...message: unknown[]) {
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
