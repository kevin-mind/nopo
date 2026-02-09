import { Script } from "../lib.ts";
import { ScriptArgs } from "../script-args.ts";

export default class EnvScript extends Script {
  static override name = "env";
  static override description = "Set up environment variables";

  static override args = new ScriptArgs({});

  override async fn(_args: ScriptArgs) {
    const { chalk } = this.runner.logger;

    this.runner.environment.save();

    const colors = {
      added: chalk.magenta,
      updated: chalk.yellow,
      unchanged: chalk.white,
      removed: chalk.red,
      background: chalk.gray,
    };

    const action = this.runner.environment.hasPrevEnv ? "Updated" : "Created";
    const actionColor = this.runner.environment.hasPrevEnv
      ? colors.updated
      : colors.added;
    const title = `${action}: ${actionColor(this.runner.environment.envFile)}`;
    const breakLine = chalk.gray(Array(title.length).fill("-").join(""));

    this.runner.logger.log(title);
    this.runner.logger.log(breakLine);

    const diffKeys = ["added", "updated", "removed", "unchanged"] as const;
    for (const key of diffKeys) {
      const section = this.runner.environment.diff[key];
      if (section.length === 0) continue;
      const colorFn = colors[key];
      this.runner.logger.log(chalk.underline(colorFn(key)));
      for (const [name, value] of section) {
        this.runner.logger.log(
          `${colors.background(name)}: ${colorFn(value ?? "")}`,
        );
      }
    }
  }
}
