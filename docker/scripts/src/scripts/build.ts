import { $, ProcessPromise } from "zx";
import { Script, type ScriptDependency } from "../lib.js";
import EnvScript from "./env.js";

export default class BuildScript extends Script {
  static override name = "build";
  static override description = "Build the base image";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  async bake(...args: string[]): Promise<ProcessPromise> {
    return this.exec`docker buildx bake ${args}`;
  }

  async builder(): Promise<string> {
    const builder = "nopo-builder";
    const customBuilder = this.runner.config.processEnv.DOCKER_BUILDER;

    if (customBuilder) return customBuilder;

    const p = await $`docker buildx inspect ${builder}`.nothrow();
    if (p.exitCode !== 0) {
      this.log(`Builder '${builder}' not found, creating it...`);
      await this
        .exec`docker buildx create --name ${builder} --driver docker-container`;
    }

    return builder;
  }

  override async fn(): Promise<void> {
    const commandOptions = [
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      this.runner.environment.envFile,
      "--debug",
      "--progress=plain",
    ];
    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";
    const builder = await this.builder();

    this.log(`
      Building image: ${this.runner.environment.env.DOCKER_TAG}
      - builder: "${builder}"
      - push: "${push}"
    `);

    commandOptions.push("--builder", builder);
    commandOptions.push("--load");
    if (push) commandOptions.push("--push");

    await this.bake(...commandOptions, "--print");
    await this.bake(...commandOptions);
  }
}
