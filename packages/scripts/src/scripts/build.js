import { Script } from "../lib.js";
import EnvScript from "./env.js";

export default class BuildScript extends Script {
  static name = "build";
  static description = "Build the base image";
  static dependencies = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  async bake(...args) {
    return this.exec`docker buildx bake ${args}`;
  }

  async fn() {
    const commandOptions = [
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      this.runner.environment.envFile,
      "--debug",
      "--progress=plain",
    ];

    this.log(`Building image: ${this.runner.environment.env.DOCKER_TAG}`);

    if (this.runner.config.processEnv.DOCKER_BUILDER) {
      this.log("- builder:", this.runner.config.processEnv.DOCKER_BUILDER);
      commandOptions.push(
        "--builder",
        this.runner.config.processEnv.DOCKER_BUILDER,
      );
    }

    if (this.runner.config.processEnv.DOCKER_PUSH) {
      this.log("- pushing image");
      commandOptions.push("--push");
    } else {
      this.log("- loading image");
      commandOptions.push("--load");
    }

    await this.bake(...commandOptions, "--print");
    await this.bake(...commandOptions);
  }
}
