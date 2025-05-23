import { chalk } from "zx";

export class Script {
  static name;
  static description;
  static dependencies = [];

  async fn() {
    throw new Error("Not implemented");
  }
}

export class Runner {
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

  async run(script, config) {
    const scripts = this.resolveDependencies(script);
    const line = `\n${Array(80).fill("=").join("")}\n`;
    for await (const Script of scripts) {
      console.log(chalk.magenta(
        line,
        `${chalk.bold(Script.name)}: ${Script.description}`,
        line,
      ));
      const script = new Script();
      await script.fn(config);
    }
  }
}
