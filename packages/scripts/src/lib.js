import { chalk } from "zx";

export class Script {
  static name;
  static description;
  static dependencies = [];

  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async fn() {
    throw new Error("Not implemented");
  }
}

class Logger {
  noop() {}
  constructor(config) {
    for (const key in console) {
      this[key] = config.silent ? this.noop : console[key];
    }
  }
}

export class Runner {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config);
  }

  resolveDependencies(script, seen = new Set()) {
    if (script.dependencies.length === 0) {
      seen.add(script);
      return seen;
    }

    for (const dep of script.dependencies) {
      this.resolveDependencies(dep, seen);
    }

    seen.add(script);
    return seen;
  }

  async run(script) {
    const scripts = this.resolveDependencies(script);
    const line = `\n${Array(80).fill("=").join("")}\n`;
    for await (const Script of scripts) {
      this.logger.log(
        chalk.magenta(
          line,
          `${chalk.bold(Script.name)}: ${Script.description}`,
          line,
        ),
      );
      const script = new Script(this.config, this.logger);
      await script.fn();
    }
  }
}
