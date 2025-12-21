import fs from "node:fs";
import path from "node:path";
import {
  Script,
  type ScriptDependency,
  $,
  type ProcessPromise,
  minimist,
} from "../lib.ts";
import EnvScript from "./env.ts";
import { DockerTag } from "../docker-tag.ts";

type BuildCliArgs = {
  services: string[];
  dockerFile?: string;
};

const SERVICE_IMAGE_SUFFIX = "_IMAGE";

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

    const p = await $({ nothrow: true })`docker buildx inspect ${builder}`;
    if (p.exitCode !== 0) {
      this.log(`Builder '${builder}' not found, creating it...`);
      await this
        .exec`docker buildx create --name ${builder} --driver docker-container`;
    }

    return builder;
  }

  override async fn() {
    const args = this.parseArgs();
    await this.buildBaseImage();
    if (args.services.length === 0) return;
    await this.buildServices(args);
  }

  private async buildBaseImage() {
    const commandOptions = [
      "-f",
      "nopo/docker/docker-bake.hcl",
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

  private parseArgs(): BuildCliArgs {
    if (this.runner.argv[0] !== "build") {
      return { services: [] };
    }

    const argv = this.runner.argv.slice(1);
    const parsed = minimist(argv);
    const serviceArg = (parsed.service ?? parsed.s) as
      | string
      | string[]
      | undefined;
    const services = this.normalizeServices(
      typeof serviceArg === "string" || Array.isArray(serviceArg)
        ? serviceArg
        : undefined,
    );
    const dockerFileInput = (parsed.dockerFile ??
      parsed.dockerfile) as string | undefined;
    const dockerFile =
      typeof dockerFileInput === "string" ? dockerFileInput : undefined;

    if (dockerFile && services.length !== 1) {
      throw new Error(
        "--dockerFile can only be used when exactly one --service is provided",
      );
    }

    return { services, dockerFile };
  }

  private normalizeServices(
    value: string | string[] | undefined,
  ): string[] {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    const names = list
      .flatMap((item) =>
        item
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      )
      .map((name) => name.toLowerCase());
    return [...new Set(names)];
  }

  private serviceEnvKey(service: string): string {
    return `${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}${SERVICE_IMAGE_SUFFIX}`;
  }

  private defaultDockerfileFor(service: string): string {
    return path.join(this.runner.config.root, "apps", service, "Dockerfile");
  }

  private resolveDockerfile(
    service: string,
    override?: string,
  ): string {
    if (override) {
      const resolved = path.isAbsolute(override)
        ? override
        : path.join(this.runner.config.root, override);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Custom docker file not found: ${resolved}`);
      }
      return resolved;
    }

    const dockerfile = this.defaultDockerfileFor(service);
    if (!fs.existsSync(dockerfile)) {
      throw new Error(
        `Service '${service}' is missing ${dockerfile}. Provide --dockerFile to override.`,
      );
    }
    return dockerfile;
  }

  private async buildServices(args: BuildCliArgs) {
    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";
    for (const name of args.services) {
      const dockerfile = this.resolveDockerfile(name, args.dockerFile);
      const imageTag = this.serviceImageTag(name);

      this.log(`Building service image '${name}'`);
      await this.exec`docker build --file ${dockerfile} --build-arg NOPO_BASE_IMAGE=${this.runner.environment.env.DOCKER_TAG} --build-arg SERVICE_NAME=${name} --tag ${imageTag} ${this.runner.config.root}`;

      await this.verifyInheritance(imageTag);

      if (push) {
        await this.exec`docker push ${imageTag}`;
      }

      this.runner.environment.setExtraEnv(
        this.serviceEnvKey(name),
        imageTag,
      );
    }

    this.runner.environment.save();
  }

  private serviceImageTag(service: string): string {
    const env = this.runner.environment.env;
    const baseImage = `${env.DOCKER_IMAGE}-${service}`;
    const parsed = new DockerTag({
      registry: env.DOCKER_REGISTRY,
      image: baseImage,
      version: env.DOCKER_VERSION,
    });
    return parsed.fullTag;
  }

  private async verifyInheritance(imageTag: string) {
    const { stdout } =
      await this.exec`docker run --rm --entrypoint cat ${imageTag} /build-info.json`;
    let info: Record<string, string>;
    try {
      info = JSON.parse(stdout.trim());
    } catch (error) {
      throw new Error(
        `Unable to verify base image for ${imageTag}: ${String(error)}`,
      );
    }

    if (info.tag !== this.runner.environment.env.DOCKER_TAG) {
      throw new Error(
        `Image ${imageTag} does not inherit from ${this.runner.environment.env.DOCKER_TAG}`,
      );
    }
  }
}
