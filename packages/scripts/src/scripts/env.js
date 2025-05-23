import { chalk } from "zx";
import { Script } from "../lib.js";
import { ParseEnv } from "../parse-env.js";

export default class EnvScript extends Script {
  static name = "env";
  static description = "Set up environment variables";

  logDiff(diff, envFile, hasPrevEnv) {
    const colors = {
      added: chalk.magenta,
      updated: chalk.yellow,
      unchanged: chalk.white,
      removed: chalk.red,
      background: chalk.gray,
    };

    const action = hasPrevEnv ? "Updated" : "Created";
    const actionColor = hasPrevEnv ? colors.updated : colors.added;
    const title = `${action}: ${actionColor(envFile)}`;
    const breakLine = chalk.gray(Array(title.length).fill("-").join(""));

    console.log(title);
    console.log(breakLine);

    for (const [key, section] of Object.entries(diff)) {
      if (section.length === 0) continue;
      console.log(chalk.underline(colors[key](key)));
      for (const [name, value] of section) {
        console.log(`${colors.background(name)}: ${colors[key](value)}`);
      }
    }
  }

  async fn(config) {
    const parseEnv = new ParseEnv(config.envFile, process.env);
    parseEnv.save();
    this.logDiff(parseEnv.diff, config.envFile, parseEnv.prevEnv);
  }
}
