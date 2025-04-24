import { fs, dotenv, chalk } from "zx";

import { parseEnv } from "../parse-env.js";

export default async function main(config) {
  const env = parseEnv(config.envFile, config.env);

  const sortedEnv = Object.fromEntries(
    Object.entries(env).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const outputEnvString = dotenv.stringify(sortedEnv);

  if (!config.dryRun) {
    fs.writeFileSync(config.envFile, outputEnvString);
    console.log(chalk.green("Updated .env file"));
    for (const [key, value] of Object.entries(sortedEnv)) {
      const text = `${key}=${value}`;
      console.log(text);
    }
  }
  return sortedEnv;
}
