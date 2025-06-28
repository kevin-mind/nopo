import { Script } from "../lib.js";

export default class EnvScript extends Script {
  static name = "env";
  static description = "Set up environment variables";

  async fn() {
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

    for (const key of Object.keys(this.runner.environment.diff)) {
      const section = this.runner.environment.diff[key];
      if (section.length === 0) continue;
      this.runner.logger.log(chalk.underline(colors[key](key)));
      for (const [name, value] of section) {
        this.runner.logger.log(
          `${colors.background(name)}: ${colors[key](value)}`,
        );
      }
    }
  }
}
