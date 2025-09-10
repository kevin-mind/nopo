#!/usr/bin/env node

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const configFile = (app) => resolve(__dirname, "..", "configs", `${app}.toml`);
const dockerImage = (app, version) => `registry.fly.io/${app}:${version}`;
const publicUrl = (app) => `https://${app}.fly.dev`;

async function getVersion(app, checkUrl = "/__version__") {
  const url = `${publicUrl(app)}${checkUrl}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const result = await fetch(url, { signal: controller.signal });
    if (!result.ok) {
      throw new Error(`Failed to fetch ${url}: ${result.statusText}`);
    }
    const json = await result.json();
    return json?.version ?? "";
  } catch (error) {
    console.error(`Failed to fetch ${url}: ${error}`);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function waitUntilHealthy(
  app,
  version,
  checkUrl,
  retries = 10,
  wait = 10,
  attempts = 0,
) {
  if (attempts > retries) throw new Error("Retries exceeded");

  console.info(`Waiting for ${app} to be healthy...`);

  const currentVersion = await getVersion(app, checkUrl);

  if (currentVersion !== version) {
    await sleep(wait * 1000);
    return waitUntilHealthy(
      app,
      version,
      checkUrl,
      retries,
      wait,
      attempts + 1,
    );
  }

  console.info(`${app} is healthy`);
}

// Helper function to execute shell commands
function exec(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, { stdio: "inherit", shell: false });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      } else {
        resolve();
      }
    });
    proc.on("error", reject);
  });
}

async function deployImage(app, version) {
  const configPath = configFile(app);
  const image = dockerImage(app, version);
  await exec("flyctl", [
    "deploy",
    "--app",
    app,
    "--config",
    configPath,
    "--image",
    image,
    "--depot=false",
  ]);
}

async function deployFile(app, file) {
  const configPath = configFile(app);
  await exec("flyctl", [
    "deploy",
    "--dockerfile",
    file,
    "--app",
    app,
    "--config",
    configPath,
    "--depot=false",
  ]);
}

const env = z
  .object({
    app: z.string(),
    version: z.string().optional(),
    file: z.string().optional(),
    checkUrl: z.string().default("/__version__"),
    retries: z.coerce.number().default(10),
    wait: z.coerce.number().default(10),
    dry: z.coerce.boolean().default(false),
  })
  .superRefine((env, ctx) => {
    if (!env.version && !env.file) {
      ctx.addIssue({
        code: z.ZodIssueCode.CUSTOM,
        message: "Either version or file must be provided",
      });
      return false;
    }
    return true;
  })
  .parse(process.env);

const envString = Object.entries(env)
  .map(([key, value]) => `${key}: ${value}`)
  .join("\n");

console.debug(
  [
    `Deploying ${env.app}... ${env.dry ? "(dry run)" : ""}`,
    envString,
    `config: ${configFile(env.app)}`,
  ].join("\n"),
);

if (env.dry) {
  process.exit(0);
}

const currentVersion = await getVersion(env.app, env.checkUrl);

console.info(`Current version: ${currentVersion}`);

if (env.version) {
  await deployImage(env.app, env.version);

  await waitUntilHealthy(
    env.app,
    env.version,
    env.checkUrl,
    env.retries,
    env.wait,
  );
}

if (env.file) {
  await deployFile(env.app, env.file);
}
