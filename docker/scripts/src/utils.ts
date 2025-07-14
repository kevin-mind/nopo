import { fs } from "zx";
import { Runner } from "./lib.ts";
import { chalk } from "zx";

export function isInContainer() {
  return fs.existsSync("/build-info.json");
}

export function isBuild({ config, environment }: Runner): boolean {
  const forceBuild = !!config.processEnv.DOCKER_BUILD;
  const localVersion = environment.env.DOCKER_VERSION === "local";
  return forceBuild || localVersion;
}

export function isPull(runner: Runner): boolean {
  return !isBuild(runner);
}

export const createLogger =
  (name: string, color: string = "black") =>
  (chunk: Buffer, streamSource?: "stdout" | "stderr"): void => {
    const messages = chunk.toString().trim().split("\n");
    const log = streamSource === "stdout" ? console.log : console.error;
    for (const message of messages) {
      const colorFn =
        color === "green"
          ? chalk.green
          : color === "yellow"
            ? chalk.yellow
            : color === "blue"
              ? chalk.blue
              : chalk.white;
      log(colorFn(`[${name}] ${message}`));
    }
  };
