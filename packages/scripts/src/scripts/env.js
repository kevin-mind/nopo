import { fs, dotenv, chalk } from "zx";

import { parseEnv } from "../parse-env.js";

export default async function main(config) {
  const env = parseEnv(config.envFile, config.env);

  const sortedEnvString = Object.entries(env)
    .filter(([, value]) => !!value)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");

  if (!config.dryRun) {
    fs.writeFileSync(config.envFile, sortedEnvString);
  }

  const colors = {
    added: chalk.magenta,
    updated: chalk.yellow,
    unchanged: chalk.white,
    background: chalk.gray,
  };

  const hasPrevEnv = fs.existsSync(config.envFile);
  const action = hasPrevEnv ? "Updated" : "Created";
  const actionColor = hasPrevEnv ? colors.updated : colors.added;
  const title = `${action}: ${actionColor(config.envFile)}`;
  const breakLine = chalk.gray(Array(title.length).fill("-").join(""));
  console.log(title);
  console.log(breakLine);
  Object.entries(colors).forEach(([key, color]) => {
    if (key === "background") return;
    console.log(`${colors.background(key)}: ${color(key)}`);
  });
  console.log(breakLine);

  let prevEnv = {};
  if (hasPrevEnv) {
    prevEnv = dotenv.parse(fs.readFileSync(config.envFile, "utf8"));
  }

  for (const [key, value] of Object.entries(env)) {
    let color = colors.unchanged;
    if (!prevEnv[key]) {
      color = colors.added;
    } else if (prevEnv[key] !== value) {
      color = colors.updated;
    }
    const text = `${colors.background(key)}=${color(value)}`;
    console.log(text);
  }
  return env;
}
