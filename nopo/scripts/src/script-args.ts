import { minimist, type ParsedArgs } from "./lib.ts";
import type { Runner } from "./lib.ts";

/**
 * Configuration for a single argument
 */
export interface ScriptArgConfig<T = any> {
  type: "string" | "boolean" | "number" | "string[]";
  description: string;
  alias?: string[];
  default: T;
  validate?: (value: T, runner?: Runner) => void | Promise<void>;
  hidden?: boolean; // For internal args not shown in help
}

/**
 * Container for argument definitions and parsed values
 * Provides type-safe access to command-line arguments
 */
export class ScriptArgs {
  private schema: Record<string, ScriptArgConfig>;
  private values: Record<string, any>;
  private runner?: Runner;

  constructor(schema: Record<string, ScriptArgConfig>, runner?: Runner) {
    this.schema = schema;
    this.runner = runner;
    this.values = {};
  }

  /**
   * Extend with additional arg definitions
   * Returns a new ScriptArgs instance with combined schema
   */
  extend(additionalSchema: Record<string, ScriptArgConfig>): ScriptArgs {
    return new ScriptArgs(
      { ...this.schema, ...additionalSchema },
      this.runner,
    );
  }

  /**
   * Parse argv and populate values
   */
  parse(argv: string[]): this {
    // Build minimist options from schema
    const minimistOpts = this.buildMinimistOptions();

    // Parse with minimist
    const parsed = minimist(argv, minimistOpts);

    // Extract and validate each arg
    for (const [key, config] of Object.entries(this.schema)) {
      const value = this.extractValue(key, config, parsed);

      // Validate
      if (config.validate) {
        config.validate(value, this.runner);
      }

      this.values[key] = value;
    }

    return this;
  }

  /**
   * Get parsed value with type safety
   * Returns the parsed value or the default if not set
   */
  get<T = any>(key: string): T {
    return this.values[key] ?? this.schema[key]?.default;
  }

  /**
   * Set value (for dependency arg overrides)
   */
  set(key: string, value: any): void {
    this.values[key] = value;
  }

  /**
   * Check if value was explicitly provided (not default)
   */
  isExplicit(key: string): boolean {
    return key in this.values;
  }

  /**
   * Get all arg configs for introspection
   */
  getSchema(): Record<string, ScriptArgConfig> {
    return { ...this.schema };
  }

  /**
   * Generate help text for all args
   */
  generateHelp(): string {
    const lines: string[] = [];

    for (const [key, config] of Object.entries(this.schema)) {
      if (config.hidden) continue;

      // Build flag names with aliases
      const flags: string[] = [`--${key}`];
      if (config.alias) {
        for (const alias of config.alias) {
          flags.push(alias.length === 1 ? `-${alias}` : `--${alias}`);
        }
      }

      // Build type indicator
      let typeIndicator = "";
      if (config.type === "string") {
        typeIndicator = " <value>";
      } else if (config.type === "number") {
        typeIndicator = " <number>";
      } else if (config.type === "string[]") {
        typeIndicator = " <value...>";
      }

      // Format line
      const flagsStr = flags.join(", ");
      const defaultStr =
        config.default !== undefined ? ` (default: ${config.default})` : "";
      lines.push(
        `  ${flagsStr}${typeIndicator}  ${config.description}${defaultStr}`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Build minimist options from schema
   */
  private buildMinimistOptions(): {
    boolean?: string[];
    string?: string[];
    alias?: Record<string, string | string[]>;
    default?: Record<string, any>;
  } {
    const booleanArgs: string[] = [];
    const stringArgs: string[] = [];
    const aliases: Record<string, string | string[]> = {};
    const defaults: Record<string, any> = {};

    for (const [key, config] of Object.entries(this.schema)) {
      // Type handling
      if (config.type === "boolean") {
        booleanArgs.push(key);
      } else if (
        config.type === "string" ||
        config.type === "number" ||
        config.type === "string[]"
      ) {
        stringArgs.push(key);
      }

      // Aliases
      if (config.alias && config.alias.length > 0) {
        aliases[key] = config.alias.length === 1 ? config.alias[0]! : config.alias;
      }

      // Defaults
      if (config.default !== undefined) {
        defaults[key] = config.default;
      }
    }

    return {
      boolean: booleanArgs.length > 0 ? booleanArgs : undefined,
      string: stringArgs.length > 0 ? stringArgs : undefined,
      alias: Object.keys(aliases).length > 0 ? aliases : undefined,
      default: Object.keys(defaults).length > 0 ? defaults : undefined,
    };
  }

  /**
   * Extract value from parsed args based on config
   */
  private extractValue(
    key: string,
    config: ScriptArgConfig,
    parsed: ParsedArgs,
  ): any {
    const rawValue = parsed[key];

    if (rawValue === undefined) {
      return undefined; // Will use default in get()
    }

    // Type conversion
    if (config.type === "number") {
      const num = Number(rawValue);
      if (isNaN(num)) {
        throw new Error(`Invalid number for --${key}: ${rawValue}`);
      }
      return num;
    }

    if (config.type === "boolean") {
      return Boolean(rawValue);
    }

    if (config.type === "string[]") {
      // Ensure array
      return Array.isArray(rawValue) ? rawValue : [rawValue];
    }

    // string type
    return String(rawValue);
  }
}
