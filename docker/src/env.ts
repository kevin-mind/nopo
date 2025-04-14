import { z } from "zod";
import { parseEnv } from "znv";
import { $, fs, chalk, dotenv, within } from "zx";

import { config } from "./config";

$.cwd = config.root;

const env = parseEnv(process.env, {
  NODE_ENV: z.string().default("development"),
  POSTGRES_DB: z.string().default("mydatabase"),
  POSTGRES_USER: z.string().default("myuser"),
  POSTGRES_PASSWORD: z.string().default("mypassword"),
  WEB_DOCKER_PORT: z.coerce.string().regex(/^\d+$/).default("3000"),
  WEB_DOCKER_TAG: z.string().default("website/web:latest"),
  DOCKER_TARGET: z.string().default("development"),
});

const envString = dotenv.stringify(env);

within(async () => {
  await fs.writeFile(config.env, envString);
  console.log(chalk.green(`Environment variables written to ${config.env}`));
  console.log(chalk.green(envString));
});
