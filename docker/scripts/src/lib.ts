import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
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

// Minimal ANSI color helper (chalk-like)
type ChalkColor = "black" | "red" | "blue" | "yellow" | "green" | "magenta" | "gray" | "white";
type ChalkFn = (...args: unknown[]) => string;

function ansi(code: number): ChalkFn {
  return (...args: unknown[]) => `\x1b[${code}m${args.map(String).join(" ")}\x1b[0m`;
}

export const chalk: Record<ChalkColor | "bold" | "underline", ChalkFn> & { level?: number } = {
  black: ansi(30),
  red: ansi(31),
  green: ansi(32),
  yellow: ansi(33),
  blue: ansi(34),
  magenta: ansi(35),
  white: ansi(37),
  gray: ansi(90),
  bold: ansi(1),
  underline: ansi(4),
  level: 2,
};

// Minimal argv parser (minimist-like)
export function parseArgs(argv: string[]): { _: string[]; [key: string]: unknown } {
  const result: { _: string[]; [key: string]: unknown } = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "--") {
      // rest are positional
      result._.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (token.startsWith("--no-")) {
        const key = token.slice(5);
        result[key] = false;
        continue;
      }
      if (eqIdx !== -1) {
        const key = token.slice(2, eqIdx);
        const value = token.slice(eqIdx + 1);
        result[key] = value;
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          result[key] = next;
          i++;
        } else {
          result[key] = true;
        }
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      const flags = token.slice(1).split("");
      for (const f of flags) result[f] = true;
      continue;
    }
    result._.push(token);
  }
  return result;
}

// Minimal dotenv helpers
export const dotenv = {
  load(filePath: string): Record<string, string> {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const env: Record<string, string> = {};
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        env[key] = value;
      }
      return env;
    } catch {
      return {};
    }
  },
  stringify(env: Record<string, unknown>): string {
    return Object.entries(env)
      .map(([k, v]) => `${k}="${v ?? ""}"`)
      .join("\n");
  },
};

export function tmpfile(suffix = "", contents?: string): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const normalized = suffix && !suffix.startsWith(".") && !suffix.startsWith("-") ? `-${suffix}` : suffix;
  const filePath = path.join(os.tmpdir(), `nopo-${unique}${normalized}`);
  if (contents !== undefined) {
    fs.writeFileSync(filePath, contents, "utf8");
  } else {
    fs.writeFileSync(filePath, "", "utf8");
  }
  return filePath;
}

export type ExecResult = { stdout: string; stderr: string; exitCode: number };

export class ProcessOutput extends Error {
  stdout: string;
  stderr: string;
  exitCode: number;
  constructor(message: string, result: ExecResult) {
    super(message);
    this.name = "ProcessOutput";
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.exitCode = result.exitCode;
  }
}

export type ProcessPromise = Promise<ExecResult> & {
  nothrow(): Promise<ExecResult>;
  text(): Promise<string>;
};

interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  verbose?: boolean;
}

function buildCommand(pieces: TemplateStringsArray, values: unknown[]): string {
  let out = "";
  for (let i = 0; i < pieces.length; i++) {
    out += pieces[i];
    if (i < values.length) {
      const value = values[i];
      if (Array.isArray(value)) {
        out += value.join(" ");
      } else {
        out += String(value ?? "");
      }
    }
  }
  return out.trim();
}

export function createExec(options: ExecOptions = {}) {
  const { cwd, env, verbose = true } = options;
  const execTag = (pieces: TemplateStringsArray, ...values: unknown[]): ProcessPromise => {
    const command = buildCommand(pieces, values);
    if (verbose) {
      // eslint-disable-next-line no-console
      console.log(chalk.gray(command));
    }
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const base = new Promise<ExecResult>((resolve, reject) => {
      child.on("error", (err) => {
        const result: ExecResult = { stdout, stderr: String(err), exitCode: 1 };
        reject(new ProcessOutput(`Command failed: ${command}`, result));
      });
      child.on("close", (code) => {
        const exitCode = typeof code === "number" ? code : 0;
        const result: ExecResult = { stdout, stderr, exitCode };
        if (exitCode === 0) resolve(result);
        else reject(new ProcessOutput(`Command failed: ${command}`, result));
      });
    }) as ProcessPromise;

    base.nothrow = async () => {
      try {
        return await base;
      } catch (err) {
        if (err instanceof ProcessOutput) {
          return { stdout: err.stdout, stderr: err.stderr, exitCode: err.exitCode };
        }
        return { stdout, stderr: String(err), exitCode: 1 };
      }
    };
    base.text = async () => {
      const res = await base;
      return res.stdout.trim();
    };
    return base;
  };
  return execTag;
}

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
    return createExec({
      cwd: this.runner.config.root,
      verbose: true,
      env: this.env as NodeJS.ProcessEnv,
    });
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
          this.logger.log(error.stack ?? "");
          process.exit(error.exitCode);
        }
        throw error;
      }
    }
  }
}
