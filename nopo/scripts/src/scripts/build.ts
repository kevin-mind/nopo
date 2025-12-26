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

  override async fn(args: BuildCliArgs) {
    const bakeFile = this.generateBakeDefinition(args.targets);

    await this.runBake(bakeFile, args);

    if (args.output) {
      await this.outputBuildInfo(args.targets, args.output);
    }
  }

  private generateBakeDefinition(requestedTargets: string[]): string {
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
      definition.target.base = {
        context: ".",
        dockerfile: path.relative(this.runner.config.root, baseDockerfile),
        tags: [env.DOCKER_TAG],
        target: env.DOCKER_TARGET,
        "cache-from": ["type=gha"],
        "cache-to": ["type=gha,mode=max"],
        args: {
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
      const dockerfile = this.defaultDockerfileFor(target);

      if (!fs.existsSync(dockerfile)) {
        throw new Error(`Target '${target}' is missing ${dockerfile}.`);
      }

      definition.target[target] = {
        context: ".",
        dockerfile: path.relative(this.runner.config.root, dockerfile),
        tags: [serviceTag],
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
    commandOptions.push("--load");
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

  private defaultDockerfileFor(service: string): string {
    return path.join(this.runner.config.root, "apps", service, "Dockerfile");
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
