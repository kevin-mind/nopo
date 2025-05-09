import { fs, dotenv, chalk } from "zx";

import { parseEnv } from "../parse-env.js";

export default async function main(config) {
  const hasPrevEnv = fs.existsSync(config.envFile);
  const prevEnv = hasPrevEnv
    ? dotenv.parse(fs.readFileSync(config.envFile, "utf8"))
    : {};

  const env = parseEnv(config.envFile, config.env);

  const sortedEnv = Object.fromEntries(
    Object.entries(env).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const outputEnvString = dotenv.stringify(sortedEnv);

  if (!config.dryRun) {
    fs.writeFileSync(config.envFile, outputEnvString);

    const createdColor = chalk.magenta;
    const updatedColor = chalk.yellow;
    const unchangedColor = chalk.white;
    const backgroundColor = chalk.gray;

    const action = hasPrevEnv ? "Updated" : "Created";
    const actionColor = hasPrevEnv ? updatedColor : createdColor;
    const title = `${action}: ${actionColor(config.envFile)}`;
    console.log(title);
    console.log(chalk.gray(Array(title.length).fill("-").join("")));
    console.log(`${backgroundColor("added")}: ${createdColor("magenta")}`);
    console.log(`${backgroundColor("updated")}: ${updatedColor("yellow")}`);
    console.log(`${backgroundColor("unchanged")}: ${unchangedColor("white")}`);
    console.log(chalk.gray(Array(title.length).fill("-").join("")));
    for (const [key, value] of Object.entries(sortedEnv)) {
      let color = unchangedColor;
      if (!prevEnv[key]) {
        color = createdColor;
      } else if (prevEnv[key] !== value) {
        color = updatedColor;
      }
      const text = `${chalk.gray(key)}=${color(value)}`;
      console.log(text);
    }
  }
  return sortedEnv;
}
