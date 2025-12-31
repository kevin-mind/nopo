import fs from "node:fs";
import path from "node:path";
import {
  TargetScript,
  type ScriptDependency,
  type Runner,
  $,
  type ProcessPromise,
  tmpfile,
  NOPO_APP_UID,
  NOPO_APP_GID,
} from "../lib.ts";
import type { NormalizedDirectoryService } from "../config/index.ts";
import EnvScript from "./env.ts";
import { DockerTag } from "../docker-tag.ts";
import { parseTargetArgs } from "../target-args.ts";

type BuildCliArgs = {
  targets: string[];
  noCache: boolean;
  output?: string;
};

interface BakeTarget {
  context: string;
  dockerfile: string;
  tags: string[];
  target?: string;
  args?: Record<string, string>;
  contexts?: Record<string, string>;
  "cache-from"?: string[];
  "cache-to"?: string[];
  output?: string[];
}

interface BakeDefinition {
  group: {
    default: {
      targets: string[];
    };
  };
  target: Record<string, BakeTarget>;
}

const SERVICE_IMAGE_SUFFIX = "_IMAGE";

export default class BuildScript extends TargetScript<BuildCliArgs> {
  static override name = "build";
  static override description = "Build base image and service images";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): BuildCliArgs {
    // When run as dependency, return default args
    if (isDependency || runner.argv[0] !== "build") {
      return { targets: [], noCache: false };
    }

    const argv = runner.argv.slice(1);
    const availableTargets = ["base", ...runner.config.targets];
    const parsed = parseTargetArgs("build", argv, availableTargets, {
      boolean: ["no-cache"],
      string: ["output"],
      alias: { "no-cache": "noCache" },
    });

    const noCache = (parsed.options["no-cache"] as boolean) === true;
    const output = parsed.options["output"] as string | undefined;

    return { targets: parsed.targets, noCache, output };
  }

  async bake(...args: string[]): Promise<ProcessPromise> {
    return this.exec`docker buildx bake ${args}`;
  }

  async builder(): Promise<string> {
    const customBuilder = this.runner.config.processEnv.DOCKER_BUILDER;
    if (customBuilder) return customBuilder;

    // For local builds, use the default docker builder (faster, no export needed)
    // For CI, use docker-container driver for better caching
    const isCI =
      process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

    if (!isCI) {
      this.log(
        "Using default Docker builder for local development (faster builds)",
      );
      return "default";
    }

    // CI: use or create nopo-builder with docker-container driver
    const builder = "nopo-builder";
    const p = await $({ nothrow: true })`docker buildx inspect ${builder}`;
    if (p.exitCode !== 0) {
      this.log(`Builder '${builder}' not found, creating it...`);
      await this
        .exec`docker buildx create --name ${builder} --driver docker-container`;
    }

    return builder;
  }

  override async fn(args: BuildCliArgs) {
    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";
    const bakeFile = this.generateBakeDefinition(args.targets, push);

    await this.runBake(bakeFile, args);

    if (args.output) {
      await this.outputBuildInfo(args.targets, args.output);
    }
  }

  private generateBakeDefinition(
    requestedTargets: string[],
    push: boolean,
  ): string {
    const env = this.runner.environment.env;
    const targets = this.runner.config.targets;

    const allTargets = ["base", ...targets];
    const buildTargets =
      requestedTargets.length > 0 ? requestedTargets : allTargets;

    const definition: BakeDefinition = {
      group: {
        default: {
          targets: buildTargets,
        },
      },
      target: {},
    };

    const needsBase =
      buildTargets.includes("base") ||
      buildTargets.some((t) => targets.includes(t));
    if (needsBase) {
      const baseDockerfile = path.join(
        this.runner.config.root,
        "nopo",
        "docker",
        "Dockerfile",
      );
      const isCI =
        process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

      const baseArgs = this.getBaseBuildArgs();
      definition.target.base = {
        context: ".",
        dockerfile: path.relative(this.runner.config.root, baseDockerfile),
        tags: [env.DOCKER_TAG],
        target: env.DOCKER_TARGET,
        ...(push ? {} : { output: ["type=docker"] }),
        ...(isCI
          ? {
              "cache-from": ["type=gha"],
              "cache-to": ["type=gha,mode=max"],
            }
          : {}),
        args: {
          ...baseArgs,
          DOCKER_TARGET: env.DOCKER_TARGET,
          DOCKER_TAG: env.DOCKER_TAG,
          DOCKER_VERSION: env.DOCKER_VERSION,
          DOCKER_BUILD: env.DOCKER_VERSION,
          GIT_REPO: env.GIT_REPO,
          GIT_BRANCH: env.GIT_BRANCH,
          GIT_COMMIT: env.GIT_COMMIT,
        },
      };
    }

    for (const target of targets) {
      if (!buildTargets.includes(target)) continue;

      const serviceTag = this.serviceImageTag(target);
      const serviceDefinition = this.getDirectoryService(target);
      const dockerfile = this.defaultDockerfileFor(serviceDefinition);

      if (!fs.existsSync(dockerfile)) {
        throw new Error(`Target '${target}' is missing ${dockerfile}.`);
      }

      const relativeContext =
        path.relative(
          this.runner.config.root,
          serviceDefinition.paths.context,
        ) || ".";
      const relativeDockerfile =
        path.relative(this.runner.config.root, dockerfile) || dockerfile;

      definition.target[target] = {
        context: relativeContext,
        dockerfile: relativeDockerfile,
        tags: [serviceTag],
        ...(push ? {} : { output: ["type=docker"] }),
        contexts: {
          base: "target:base",
        },
        args: {
          SERVICE_NAME: target,
          NOPO_APP_UID,
          NOPO_APP_GID,
        },
      };

      this.runner.environment.setExtraEnv(
        this.serviceEnvKey(target),
        serviceTag,
      );
    }

    this.runner.environment.save();

    const json = JSON.stringify(definition, null, 2);
    return tmpfile("docker-bake.json", json);
  }

  private async runBake(bakeFile: string, args: BuildCliArgs): Promise<string> {
    const commandOptions = ["-f", bakeFile, "--debug", "--progress=plain"];

    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";
    const builder = await this.builder();

    const metadataFile =
      this.runner.config.processEnv.DOCKER_METADATA_FILE ||
      tmpfile("bake-metadata.json", "{}");

    this.log(`
      Building targets: ${args.targets.length > 0 ? args.targets.join(", ") : "all"}
      - builder: "${builder}"
      - push: "${push}"
      - no-cache: "${args.noCache}"
      - metadata-file: "${metadataFile}"
    `);

    commandOptions.push("--builder", builder);
    commandOptions.push("--metadata-file", metadataFile);
    if (push) commandOptions.push("--push");
    if (args.noCache) commandOptions.push("--no-cache");

    await this.bake(...commandOptions, "--print");
    await this.bake(...commandOptions);

    return metadataFile;
  }

  private serviceEnvKey(service: string): string {
    return `${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}${SERVICE_IMAGE_SUFFIX}`;
  }

  private defaultDockerfileFor(
    service: NormalizedDirectoryService,
  ): string {
    return service.paths.dockerfile;
  }

  private getDirectoryService(target: string): NormalizedDirectoryService {
    const service = this.runner.getService(target);
    if (service.origin.type !== "directory") {
      throw new Error(
        `Service "${target}" is not defined as a directory service.`,
      );
    }
    return service;
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

  private getBaseBuildArgs() {
    const { base, dependencies, user } = this.runner.config.project.os;
    const packages = this.formatOsPackages(dependencies);
    const userHome = user.home || "/home/nopo";
    const userName = path.basename(userHome) || "nopoapp";
    return {
      BASE_FROM: base.from,
      OS_PACKAGES: packages || "make jq curl",
      USER: userName,
      USER_ID: String(user.uid),
      USER_HOME: userHome,
    };
  }

  private formatOsPackages(deps: Record<string, string>): string {
    const entries = Object.entries(deps);
    if (entries.length === 0) return "";
    return entries
      .map(([name, version]) =>
        version && version.length > 0 ? `${name}=${version}` : name,
      )
      .join(" ");
  }

  private async getImageDigest(tag: string): Promise<string | null> {
    const result = await $({
      nothrow: true,
    })`docker buildx imagetools inspect ${tag} --raw`;
    if (result.exitCode !== 0) {
      return null;
    }
    try {
      const json = JSON.parse(result.stdout.trim());
      return json.manifests?.[0]?.digest || null;
    } catch {
      return null;
    }
  }

  private async outputBuildInfo(targets: string[], outputPath?: string) {
    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";
    const env = this.runner.environment.env;
    const configTargets = this.runner.config.targets;

    const allTargets = ["base", ...configTargets];
    const builtTargets = targets.length > 0 ? targets : allTargets;

    const images: Array<{
      name: string;
      tag: string;
      registry: string;
      image: string;
      version: string;
      digest: string | null;
    }> = [];

    if (builtTargets.includes("base")) {
      const baseDigest = push
        ? await this.getImageDigest(env.DOCKER_TAG)
        : null;
      images.push({
        name: "base",
        tag: env.DOCKER_TAG,
        registry: env.DOCKER_REGISTRY,
        image: env.DOCKER_IMAGE,
        version: env.DOCKER_VERSION,
        digest: baseDigest,
      });
    }

    for (const target of configTargets) {
      if (!builtTargets.includes(target)) continue;

      const serviceTag = this.serviceImageTag(target);
      const serviceDigest = push ? await this.getImageDigest(serviceTag) : null;

      images.push({
        name: target,
        tag: serviceTag,
        registry: env.DOCKER_REGISTRY,
        image: `${env.DOCKER_IMAGE}-${target}`,
        version: env.DOCKER_VERSION,
        digest: serviceDigest,
      });
    }

    const jsonOutput = JSON.stringify(images, null, 2);
    if (outputPath) {
      const resolvedPath = path.isAbsolute(outputPath)
        ? outputPath
        : path.join(this.runner.config.root, outputPath);
      fs.writeFileSync(resolvedPath, jsonOutput, "utf-8");
      this.log(`Build info written to: ${resolvedPath}`);
    } else {
      console.log(jsonOutput);
    }
  }
}
