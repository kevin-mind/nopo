import { chalk } from "zx";
import { Script } from "../lib.ts";
import { ParseEnv } from "../parse-env.ts";

export default class EnvScript extends Script {
  static name = "env";
  static description = "Set up environment variables";

  async fn() {
    const env = new ParseEnv(this.config.envFile, this.config.processEnv);
    env.save();

    const colors = {
      added: chalk.magenta,
      updated: chalk.yellow,
      unchanged: chalk.white,
      removed: chalk.red,
      background: chalk.gray,
    };

    const action = env.hasPrevEnv ? "Updated" : "Created";
    const actionColor = env.hasPrevEnv ? colors.updated : colors.added;
    const title = `${action}: ${actionColor(this.config.envFile)}`;
    const breakLine = chalk.gray(Array(title.length).fill("-").join(""));

    this.logger.log(title);
    this.logger.log(breakLine);

    for (const key of Object.keys(env.diff) as (keyof typeof env.diff)[]) {
      const section = env.diff[key];
      if (section.length === 0) continue;
      this.logger.log(chalk.underline(colors[key](key)));
      for (const [name, value] of section) {
        this.logger.log(`${colors.background(name)}: ${colors[key](value)}`);
      }
    }
  }
}
