import { z } from "zod";
import { chalk } from "zx";
import compose from "docker-compose";

import { Script } from "../lib.js";

export default class IndexScript extends Script {
  static name = "run";
  static description = "Run a pnpm script in a specified service and package";

  packageSchema = z.object({
    path: z.string(),
  });

  packageJsonSchema = z.object({
    scripts: z.record(z.string()),
  });

  async #getServicePkgJsonPath(name) {
    const [result] = await this
      .exec`pnpm ls --filter @more/${name} --depth 0 --json`.json();
    const { path: servicePath } = this.packageSchema.parse(result);
    return `${servicePath}/package.json`;
  }

  async #hasPackageScript(packageJsonPath, script) {
    const result = await this.exec`cat ${packageJsonPath}`.json();
    const { scripts } = this.packageJsonSchema.parse(result);
    return scripts[script] ?? false;
  }

  async fn() {
    let [scriptName, serviceName] = this.runner.argv;

    if (!scriptName) {
      throw new Error("Usage: run <service> <script>");
    }

    if (serviceName) {
      const packageJsonPath = await this.#getServicePkgJsonPath(serviceName);
      if (!(await this.#hasPackageScript(packageJsonPath, scriptName))) {
        throw new Error(
          `script '${scriptName}' not found in ${packageJsonPath}`,
        );
      }
    }

    if (serviceName) {
      const createLogger =
        (name, color = "black") =>
        (chunk, streamSource) => {
          const messages = chunk.toString().trim().split("\n");
          const log = streamSource === "stdout" ? console.log : console.error;
          for (const message of messages) {
            log(chalk[color](`[${name}] ${message}`));
          }
        };

      return await compose.run(
        serviceName,
        `pnpm run --filter @more/${serviceName} ${scriptName}`,
        {
          callback: createLogger(serviceName, "white"),
          commandOptions: ["--rm", "--remove-orphans"],
          env: this.env,
        },
      );
    }
    return await this.exec`pnpm run --fail-if-no-match ${scriptName}`;
  }
}
