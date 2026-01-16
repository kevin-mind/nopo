import path from "node:path";
import { z } from "zod";
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { parseTargetArgs } from "./target-args.ts";
import {
  loadProjectConfig,
  type NormalizedProjectConfig,
  type NormalizedService,
} from "./config/index.ts";
import { ScriptArgs } from "./script-args.ts";

// Constants for the nopo app user (must match base Dockerfile)
export const NOPO_APP_UID = "1001";
export const NOPO_APP_GID = "1001";

const BaseConfigSchema = z.object({
  root: z.string(),
  envFile: z.string(),
  processEnv: z.record(z.string(), z.string()),
  silent: z.boolean(),
});

type BaseConfig = z.infer<typeof BaseConfigSchema>;

export interface Config extends BaseConfig {
  targets: string[];
  project: NormalizedProjectConfig;
}

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

interface MinimistOptions {
  boolean?: string[];
  string?: string[];
  alias?: Record<string, string | string[]>;
  default?: Record<string, unknown>;
}

export function minimist(
  args: string[],
  options: MinimistOptions = {},
): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  const booleanSet = new Set(options.boolean || []);
  const aliasMap = new Map<string, string>();

  // Build alias map (both directions)
  if (options.alias) {
    for (const [key, aliases] of Object.entries(options.alias)) {
      const aliasList = Array.isArray(aliases) ? aliases : [aliases];
      for (const alias of aliasList) {
        aliasMap.set(alias, key);
        aliasMap.set(key, alias);
      }
    }
  }

  // Apply defaults
  if (options.default) {
    for (const [key, value] of Object.entries(options.default)) {
      result[key] = value as string | boolean;
    }
  }

  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (!arg) {
      i++;
      continue;
    }

    if (arg === "--") {
      result._.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      if (!key) {
        i++;
        continue;
      }
      const isBoolean = booleanSet.has(key);
      if (value !== undefined) {
        result[key] =
          value === "true" ? true : value === "false" ? false : value;
      } else if (isBoolean) {
        result[key] = true;
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
      // Apply aliases
      const alias = aliasMap.get(key);
      if (alias) {
        result[alias] = result[key];
      }
    } else if (arg.startsWith("-") && !arg.startsWith("--")) {
      const flags = arg.slice(1).split("");
      for (const flag of flags) {
        result[flag] = true;
        const alias = aliasMap.get(flag);
        if (alias) {
          result[alias] = true;
        }
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
  input?: string;
  callback?: (chunk: Buffer, streamSource?: "stdout" | "stderr") => void;
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

      // Write input to stdin if provided
      if (options.input && this.proc.stdin) {
        this.proc.stdin.on("error", (err) => {
          if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
          reject(new ProcessOutput(1, null, "", err.message));
        });
        try {
          this.proc.stdin.write(options.input);
          this.proc.stdin.end();
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
          reject(new ProcessOutput(1, null, "", (err as Error).message));
          return;
        }
      }

      if (this.proc.stdout) {
        this.proc.stdout.on("data", (chunk) => {
          stdout.push(chunk);
          if (options.callback) {
            options.callback(chunk, "stdout");
          } else if (options.verbose) {
            process.stdout.write(chunk);
          }
        });
      }

      if (this.proc.stderr) {
        this.proc.stderr.on("data", (chunk) => {
          stderr.push(chunk);
          if (options.callback) {
            options.callback(chunk, "stderr");
          } else if (options.verbose) {
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

/**
 * Execute a command with explicit arguments (no whitespace splitting).
 * Useful when arguments contain spaces.
 */
export function exec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): ProcessPromise {
  return new ProcessPromiseImpl(command, args, options);
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
const defaultRoot = process.cwd();

interface CreateConfigOptions {
  envFile?: string | undefined;
  processEnv?: Record<string, string>;
  silent?: boolean;
  rootDir?: string;
  configPath?: string;
}

export function createConfig(options: CreateConfigOptions = {}): Config {
  const {
    envFile = ".env",
    processEnv = Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined),
    ) as Record<string, string>,
    silent = false,
    rootDir,
    configPath,
  } = options;

  const resolvedRoot = path.resolve(rootDir ?? defaultRoot);
  const baseConfig = BaseConfigSchema.parse({
    root: resolvedRoot,
    envFile: path.resolve(resolvedRoot, envFile),
    processEnv,
    silent,
  });

  const project = loadProjectConfig(resolvedRoot, configPath);

  return {
    ...baseConfig,
    project,
    targets: project.services.targets,
  };
}

type Color = "black" | "red" | "blue" | "yellow" | "green" | "cyan";

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
  class: typeof BaseScript;
  enabled: boolean | ((runner: Runner) => boolean | Promise<boolean>);
  args?: (parentArgs: ScriptArgs) => Record<string, unknown>;
}

export abstract class BaseScript {
  static name = "";
  static description = "";
  static dependencies: ScriptDependency[] = [];

  runner: Runner;
  isDependency: boolean;

  constructor(runner: Runner, isDependency = false) {
    this.runner = runner;
    this.isDependency = isDependency;
  }

  get env() {
    return {
      ...this.runner.environment.processEnv,
      ...this.runner.environment.env,
      ...this.runner.environment.extraEnv,
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

export class Script<TArgs = void> extends BaseScript {
  static parseArgs?(runner: Runner, isDependency: boolean): unknown;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fn(_args?: TArgs | unknown): Promise<void> {
    throw new Error("Not implemented");
  }
}

export abstract class TargetScript<TArgs = void> extends BaseScript {
  static args?: ScriptArgs;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static parseArgs(_runner: Runner, _isDependency: boolean): unknown {
    throw new Error("parseArgs must be implemented by TargetScript subclasses");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fn(_args?: TArgs | unknown): Promise<void> {
    throw new Error("Not implemented");
  }
}

export class Runner {
  config: Config;
  environment: import("./parse-env.ts").Environment;
  logger: Logger;
  argv: string[];

  constructor(
    config: Config,
    environment: import("./parse-env.ts").Environment,
    argv: string[] = [],
    logger: Logger = new Logger(config),
  ) {
    this.config = config;
    this.environment = environment;
    this.logger = logger;
    this.argv = argv;
  }

  getService(id: string): NormalizedService {
    const service = this.config.project.services.entries[id];
    if (!service) {
      throw new Error(
        `Unknown service "${id}". Define it in nopo.yml before running this command.`,
      );
    }
    return service;
  }

  async isDependencyEnabled(dependency: ScriptDependency): Promise<boolean> {
    return typeof dependency.enabled === "function"
      ? await dependency.enabled(this)
      : dependency.enabled;
  }

  async resolveDependencies(
    ScriptClass: typeof BaseScript,
    dependenciesMap: Map<typeof BaseScript, boolean[]> = new Map(),
  ): Promise<Map<typeof BaseScript, boolean[]>> {
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

  async run(ScriptClass: typeof BaseScript): Promise<void> {
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

      // Determine if this script is running as a dependency
      const isDependency = ScriptToRun !== ScriptClass;

      // Create a runner with potentially modified argv (targets stripped for dependencies)
      const runnerForScript = this.prepareRunnerForScript(
        ScriptToRun,
        isDependency,
      );
      const scriptInstance = this.createScriptInstance(
        ScriptToRun,
        runnerForScript,
        isDependency,
      );

      try {
        // Check if script uses new ScriptArgs system
        if ((ScriptToRun as unknown as { args: unknown }).args) {
          // New ScriptArgs system
          const args = this.prepareScriptArgs(
            ScriptToRun,
            ScriptClass,
            isDependency,
          );
          await (
            scriptInstance as unknown as {
              fn: (args: unknown) => Promise<void>;
            }
          ).fn(args);
        } else if (this.isTargetScript(ScriptToRun)) {
          // Old parseArgs system for TargetScript
          const args = (ScriptToRun as typeof TargetScript).parseArgs(
            runnerForScript,
            isDependency,
          );
          await (scriptInstance as TargetScript<unknown>).fn(args);
        } else if ((ScriptToRun as typeof Script).parseArgs) {
          // Old parseArgs system for Script
          const args = (ScriptToRun as typeof Script).parseArgs!(
            runnerForScript,
            isDependency,
          );
          await (scriptInstance as Script<unknown>).fn(args);
        } else {
          await (scriptInstance as Script).fn();
        }
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

  private isTargetScript(ScriptClass: typeof BaseScript): boolean {
    return ScriptClass.prototype instanceof TargetScript;
  }

  private createScriptInstance(
    ScriptClass: typeof BaseScript,
    runner: Runner,
    isDependency: boolean,
  ): BaseScript {
    // Use constructor directly - TypeScript will handle the typing
    return new (ScriptClass as unknown as new (
      runner: Runner,
      isDependency?: boolean,
    ) => BaseScript)(runner, isDependency);
  }

  private prepareRunnerForScript(
    ScriptClass: typeof BaseScript,
    isDependency: boolean,
  ): Runner {
    // If script is not a TargetScript or not running as dependency, return runner as-is
    if (!this.isTargetScript(ScriptClass) || !isDependency) {
      return this;
    }

    // For TargetScript dependencies, strip targets from argv
    const commandName = ScriptClass.name;
    const argv = this.argv.slice(1);

    // Determine leading positionals (e.g., 1 for 'run' command)
    const leadingPositionals = commandName === "run" ? 1 : 0;

    try {
      const parsed = parseTargetArgs(commandName, argv, this.config.targets, {
        leadingPositionals,
      });

      // Create new argv with targets removed
      // Keep command name, leading args, and options, but remove targets
      const newArgv: string[] = [this.argv[0]!]; // Keep command name
      newArgv.push(...parsed.leadingArgs); // Keep leading args (e.g., script name)

      // Add options back
      for (const [key, value] of Object.entries(parsed.options)) {
        if (typeof value === "boolean" && value) {
          newArgv.push(`--${key}`);
        } else if (typeof value === "string") {
          newArgv.push(`--${key}`, value);
        }
      }

      return new Runner(this.config, this.environment, newArgv, this.logger);
    } catch {
      // If parsing fails, return original runner
      // (let the script handle the error)
      return this;
    }
  }

  /**
   * Prepare ScriptArgs for a script (new args system)
   * Handles both main scripts and dependencies, with arg overrides
   */
  private prepareScriptArgs(
    ScriptToRun: typeof BaseScript,
    ParentScript: typeof BaseScript,
    isDependency: boolean,
  ): ScriptArgs {
    // Get script's arg schema
    const argsTemplate = (ScriptToRun as unknown as { args?: ScriptArgs }).args;

    if (!argsTemplate) {
      // Script doesn't use args system (shouldn't happen, but handle gracefully)
      return new ScriptArgs({}, this);
    }

    // Clone args with runner context
    const scriptArgs = new ScriptArgs(argsTemplate.getSchema(), this);

    if (isDependency) {
      // Find dependency definition in parent
      type DependencyDef = {
        class: typeof BaseScript;
        args?: (parentArgs: ScriptArgs) => Record<string, unknown>;
      };
      const parentDeps =
        (ParentScript as unknown as { dependencies?: DependencyDef[] })
          .dependencies || [];
      const depDef = parentDeps.find((d) => d.class === ScriptToRun);

      if (depDef?.args) {
        // Parent overrides dependency args
        let parentArgs: ScriptArgs;

        // Check if parent uses new ScriptArgs system
        if ((ParentScript as unknown as { args?: unknown }).args) {
          parentArgs = this.prepareScriptArgs(
            ParentScript,
            ParentScript,
            false,
          );
        } else {
          // Parent uses old parseArgs system - create a bridge ScriptArgs
          parentArgs = new ScriptArgs({}, this);

          // If parent is TargetScript with old parseArgs, get its targets
          if (this.isTargetScript(ParentScript)) {
            const parentParsedArgs = (
              ParentScript as typeof TargetScript
            ).parseArgs(this, false);
            // Inject targets from old system
            if ((parentParsedArgs as { targets?: string[] }).targets) {
              parentArgs.set(
                "targets",
                (parentParsedArgs as { targets: string[] }).targets,
              );
            }
          }
        }

        const overrides = depDef.args(parentArgs);

        // Apply overrides (including targets!)
        for (const [key, value] of Object.entries(overrides)) {
          scriptArgs.set(key, value);
        }
      } else {
        // Use defaults for all args
        // (values stay empty, get() returns defaults)
      }
    } else {
      // For TargetScript: parse targets FIRST, strip from argv
      let argvForParsing = this.argv.slice(1); // Skip command name

      if (this.isTargetScript(ScriptToRun)) {
        const TargetScriptClass = ScriptToRun as typeof TargetScript;

        // 1. Parse targets from positionals
        const parsed = parseTargetArgs(
          TargetScriptClass.name,
          this.argv.slice(1),
          this.config.targets,
          {
            supportsFilter: true,
            services: this.config.project.services.entries,
            projectRoot: this.config.root,
          },
        );

        const targets = parsed.targets;

        // 2. Strip targets from argv - rebuild with just flags
        argvForParsing = [];

        // Add back leading args if any
        if (parsed.leadingArgs.length > 0) {
          argvForParsing.push(...parsed.leadingArgs);
        }

        // Add back options
        for (const [key, value] of Object.entries(parsed.options)) {
          if (typeof value === "boolean" && value) {
            argvForParsing.push(`--${key}`);
          } else if (value !== undefined && value !== false) {
            argvForParsing.push(`--${key}`, String(value));
          }
        }

        // 3. Set targets on args (injected separately)
        scriptArgs.set("targets", targets);
      }

      // 4. Parse remaining flags with ScriptArgs
      scriptArgs.parse(argvForParsing);
    }

    return scriptArgs;
  }
}
