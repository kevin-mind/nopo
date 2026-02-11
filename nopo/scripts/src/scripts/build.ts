import fs from "node:fs";
import path from "node:path";
import {
  TargetScript,
  type ScriptDependency,
  type Runner,
  $,
  exec,
  type ProcessPromise,
  tmpfile,
  NOPO_APP_UID,
  NOPO_APP_GID,
} from "../lib.ts";
import {
  isBuildableService,
  isPackageService,
  isVirtualBuildableService,
  requiresBuild,
  extractDependencyNames,
  type NormalizedService,
  type VirtualBuildableService,
} from "../config/index.ts";
import EnvScript from "./env.ts";
import { DockerTag } from "../docker-tag.ts";
import { baseArgs } from "../args.ts";
import type { ScriptArgs } from "../script-args.ts";

interface BakeTarget {
  context: string;
  dockerfile?: string;
  "dockerfile-inline"?: string;
  tags: string[];
  target?: string;
  args?: Record<string, string>;
  contexts?: Record<string, string>;
  "cache-from"?: string[];
  "cache-to"?: string[];
  output?: string[];
  platforms?: string[];
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
const DEFAULT_PLATFORMS = "linux/amd64,linux/arm64";

export default class BuildScript extends TargetScript {
  static override name = "build";
  static override description = "Build root image and service images";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  static override args = baseArgs.extend({
    "no-cache": {
      type: "boolean",
      description: "Build without using cache",
      default: false,
    },
    output: {
      type: "string",
      description: "Path to write build info JSON",
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- undefined default for optional arg, typed as string when provided
      default: undefined as unknown as string,
    },
  });

  /**
   * Returns extra targets that should be valid for this script.
   * Build script adds rootName (e.g., "root") as a valid target.
   */
  static getExtraTargets(runner: Runner): string[] {
    return [runner.config.project.rootName];
  }

  async bake(...args: string[]): Promise<ProcessPromise> {
    return this.exec`docker buildx bake ${args}`;
  }

  async builder(): Promise<string | null> {
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
      // Return null to let Docker use the current context's default builder
      // This avoids context mismatch issues (e.g., desktop-linux vs default)
      return null;
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

  override async fn(args: ScriptArgs) {
    const targets = args.get<string[]>("targets") ?? [];
    const noCache = args.get<boolean>("no-cache") ?? false;
    const output = args.get<string | undefined>("output");

    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";

    // Build packages first (in dependency order), then build services
    await this.buildPackages(targets);

    const bakeFile = this.generateBakeDefinition(targets, push);

    // If no buildable targets, skip the build but still write output file if requested
    if (!bakeFile) {
      this.log("Build complete - no targets to build");
      if (output) {
        this.writeEmptyOutput(output);
      }
      return;
    }

    await this.runBake(bakeFile, targets, noCache);

    if (output) {
      await this.outputBuildInfo(targets, output);
    }
  }

  /**
   * Build packages via docker run with volume mounts.
   * Packages are built by running the base container with the project mounted,
   * so artifacts persist to the host filesystem.
   */
  private async buildPackages(requestedTargets: string[]): Promise<void> {
    const targets = this.runner.config.targets;

    // Find all packages (targets without runtime configuration)
    const allPackages = targets.filter((t) => {
      const service = this.runner.getService(t);
      return isPackageService(service) && service.build?.command;
    });

    if (allPackages.length === 0) {
      return;
    }

    // Determine which packages to build
    const packagesToConsider =
      requestedTargets.length > 0
        ? requestedTargets.filter((t) => allPackages.includes(t))
        : allPackages;

    // Also include packages that are dependencies of requested targets (services or packages)
    const packagesWithDeps = this.resolvePackageDependencies(
      requestedTargets.length > 0 ? requestedTargets : targets,
      allPackages,
    );

    // Merge both: explicitly requested packages + dependency packages
    const packagesToBuild = [
      ...new Set([...packagesToConsider, ...packagesWithDeps]),
    ];

    if (packagesToBuild.length === 0) {
      return;
    }

    // Sort packages in dependency order
    const sortedPackages = this.sortPackagesByDependency(packagesToBuild);

    this.log(
      `Building ${sortedPackages.length} package(s): ${sortedPackages.join(", ")}`,
    );

    // Build each package via docker run
    for (const packageName of sortedPackages) {
      await this.buildPackage(packageName);
    }
  }

  /**
   * Resolve package dependencies for a set of targets.
   * Returns all packages that are dependencies of the given targets.
   */
  private resolvePackageDependencies(
    targets: string[],
    allPackages: string[],
  ): string[] {
    const packageDeps = new Set<string>();
    const visited = new Set<string>();

    const collectDeps = (targetName: string) => {
      if (visited.has(targetName)) return;
      visited.add(targetName);

      const service = this.runner.config.project.services.entries[targetName];
      if (!service) return;

      // Use build.depends_on only - no fallback
      const buildDepsField = service.build?.depends_on;
      const deps = buildDepsField ? extractDependencyNames(buildDepsField) : [];

      for (const dep of deps) {
        if (allPackages.includes(dep)) {
          packageDeps.add(dep);
          // Recursively collect dependencies of this package
          collectDeps(dep);
        }
      }
    };

    for (const target of targets) {
      collectDeps(target);
    }

    return Array.from(packageDeps);
  }

  /**
   * Sort packages by dependency order (dependencies first).
   * Uses topological sort to ensure packages are built before their dependents.
   */
  private sortPackagesByDependency(packages: string[]): string[] {
    const packageSet = new Set(packages);
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(
          `Circular dependency detected involving package '${name}'`,
        );
      }

      visiting.add(name);

      const service = this.runner.config.project.services.entries[name];
      if (service) {
        // Visit dependencies first (only those that are also packages to build)
        // Use build.depends_on only - no fallback
        const buildDepsField = service.build?.depends_on;
        const deps = buildDepsField
          ? extractDependencyNames(buildDepsField)
          : [];

        for (const dep of deps) {
          if (packageSet.has(dep)) {
            visit(dep);
          }
        }
      }

      visiting.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const pkg of packages) {
      visit(pkg);
    }

    return result;
  }

  /**
   * Build a single package via docker run with volume mounts.
   *
   * The build works by:
   * 1. Running the base Docker image
   * 2. Mounting the project root to /app
   * 3. Setting correct UID/GID for file permissions
   * 4. Running the build command in the package directory
   * 5. Artifacts are written to mounted volumes and persist to host
   */
  private async buildPackage(packageName: string): Promise<void> {
    const service = this.runner.getService(packageName);
    if (!service.build?.command) {
      throw new Error(
        `Package '${packageName}' has no build command configured`,
      );
    }

    const baseTag = this.runner.environment.env.DOCKER_TAG;
    if (!baseTag) {
      throw new Error("DOCKER_TAG is required for package builds");
    }

    const projectRoot = this.runner.config.root;
    const packageRelativePath = path.relative(projectRoot, service.paths.root);

    this.log(`Building package '${packageName}'...`);

    // Build the docker run command with volume mounts
    const dockerArgs = this.buildDockerRunArgs(service, packageRelativePath);

    try {
      // Execute docker run with explicit args to handle spaces in command
      const result = await exec("docker", dockerArgs, {
        cwd: projectRoot,
        env: this.env,
        verbose: true,
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Package '${packageName}' build failed with exit code ${result.exitCode}\n${result.stderr}`,
        );
      }

      this.log(`Package '${packageName}' built successfully`);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to build package '${packageName}': ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Build the docker run arguments for a package build.
   */
  private buildDockerRunArgs(
    service: NormalizedService,
    packageRelativePath: string,
  ): string[] {
    const baseTag = this.runner.environment.env.DOCKER_TAG;
    const projectRoot = this.runner.config.root;

    const args: string[] = [
      "run",
      "--rm",
      // Mount the project root to /app
      "-v",
      `${projectRoot}:/app`,
      // Set user for correct file permissions
      "-u",
      `${NOPO_APP_UID}:${NOPO_APP_GID}`,
      // Set working directory to the package path
      "-w",
      `/app/${packageRelativePath}`,
    ];

    // Add build environment variables if specified
    if (service.build?.env) {
      for (const [key, value] of Object.entries(service.build.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }

    // Add the base image
    args.push(baseTag);

    // Add the build command (run via sh -c to support complex commands)
    args.push("sh", "-c", service.build!.command!);

    return args;
  }

  private generateBakeDefinition(
    requestedTargets: string[],
    push: boolean,
  ): string | null {
    const env = this.runner.environment.env;
    const targets = this.runner.config.targets;
    const rootName = this.runner.config.project.rootName;

    // Multi-platform builds only work with registry push (type=docker doesn't support multi-platform)
    const platforms = push ? this.getPlatforms() : undefined;

    // Filter to buildable services (physical dockerfile or virtual dockerfile)
    const buildableTargets = targets.filter((t) => {
      const service = this.runner.getService(t);
      return requiresBuild(service);
    });

    const allTargets = [rootName, ...buildableTargets];
    const buildTargets =
      requestedTargets.length > 0
        ? requestedTargets.filter(
            (t) => t === rootName || buildableTargets.includes(t),
          )
        : allTargets;

    // Log skipped services
    for (const target of targets) {
      if (!buildableTargets.includes(target)) {
        this.log(`Skipping '${target}' - uses pre-built image`);
      }
    }

    // If no buildable targets remain after filtering, skip the build
    if (buildTargets.length === 0) {
      this.log("No buildable targets - skipping build");
      return null;
    }

    const definition: BakeDefinition = {
      group: {
        default: {
          targets: buildTargets,
        },
      },
      target: {},
    };

    const needsRoot =
      buildTargets.includes(rootName) ||
      buildTargets.some((t) => targets.includes(t));
    if (needsRoot) {
      const rootDockerfile = path.join(
        this.runner.config.root,
        "nopo",
        "docker",
        "Dockerfile",
      );
      const isCI =
        process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

      const rootArgs = this.getRootBuildArgs();
      definition.target[rootName] = {
        context: ".",
        dockerfile: path.relative(this.runner.config.root, rootDockerfile),
        tags: [env.DOCKER_TAG],
        target: env.DOCKER_TARGET,
        ...(push ? {} : { output: ["type=docker"] }),
        ...(platforms ? { platforms } : {}),
        ...(isCI
          ? {
              "cache-from": ["type=gha"],
              "cache-to": ["type=gha,mode=max"],
            }
          : {}),
        args: {
          ...rootArgs,
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

    for (const target of buildableTargets) {
      if (!buildTargets.includes(target)) continue;

      const service = this.runner.getService(target);
      const serviceTag = this.serviceImageTag(target);
      const relativeContext =
        path.relative(this.runner.config.root, service.paths.context) || ".";

      if (isBuildableService(service)) {
        // Physical Dockerfile
        const dockerfile = service.paths.dockerfile;

        if (!fs.existsSync(dockerfile)) {
          throw new Error(`Target '${target}' is missing ${dockerfile}.`);
        }

        const relativeDockerfile =
          path.relative(this.runner.config.root, dockerfile) || dockerfile;

        definition.target[target] = {
          context: relativeContext,
          dockerfile: relativeDockerfile,
          tags: [serviceTag],
          ...(push ? {} : { output: ["type=docker"] }),
          ...(platforms ? { platforms } : {}),
          contexts: {
            [rootName]: `target:${rootName}`,
          },
          args: {
            SERVICE_NAME: target,
            NOPO_APP_UID,
            NOPO_APP_GID,
            NOPO_BASE_IMAGE: rootName,
          },
        };
      } else if (isVirtualBuildableService(service)) {
        // Virtual inline Dockerfile - pass rootName for direct context reference
        // Compute the relative service path for output path resolution
        const relativeServicePath =
          path.relative(this.runner.config.root, service.paths.root) || ".";
        const dockerfileInline = this.generateInlineDockerfile(
          service,
          rootName,
          relativeServicePath,
        );

        definition.target[target] = {
          context: relativeContext,
          "dockerfile-inline": dockerfileInline,
          tags: [serviceTag],
          ...(push ? {} : { output: ["type=docker"] }),
          ...(platforms ? { platforms } : {}),
          contexts: {
            [rootName]: `target:${rootName}`,
          },
          args: {
            SERVICE_NAME: target,
            // Note: NOPO_APP_UID and NOPO_APP_GID are inherited as ENV from base image
            // Don't pass them as args to avoid Docker Buildx bake variable cycle errors
          },
        };
      }

      this.runner.environment.setExtraEnv(
        this.serviceEnvKey(target),
        serviceTag,
      );
    }

    this.runner.environment.save();

    const json = JSON.stringify(definition, null, 2);
    return tmpfile("docker-bake.json", json);
  }

  /**
   * Generate an inline Dockerfile for services without a physical Dockerfile.
   * The generated Dockerfile follows the pattern:
   * - Build stage: install packages, set env, copy files, run build command
   * - Final stage: copy only the specified output paths
   *
   * @param service - The service configuration
   * @param baseContextName - The base context name (e.g., "root")
   * @param relativeServicePath - Relative path from project root to service directory (e.g., "apps/web")
   *
   * Note: Uses the context name directly (e.g., "root") instead of an ARG to avoid
   * Docker Buildx bake "variable cycle" errors when the arg value matches a target name.
   *
   * NOPO_APP_UID and NOPO_APP_GID are inherited as ENV variables from the base image,
   * so we don't need to declare them as ARGs.
   *
   * IMPORTANT: When using dockerfile-inline with Docker Buildx bake, ${...} is interpreted
   * as HCL variable interpolation. To use Dockerfile ARG/ENV variables, we must escape
   * the dollar sign as $$ (e.g., $${NOPO_APP_UID} produces ${NOPO_APP_UID} in the Dockerfile).
   */
  private generateInlineDockerfile(
    service: VirtualBuildableService,
    baseContextName: string,
    relativeServicePath: string,
  ): string {
    const serviceName = service.id;
    const build = service.build;

    const lines: string[] = [];

    // Build stage - use context name directly instead of ARG
    // NOPO_APP_UID and NOPO_APP_GID are inherited as ENV from base image
    lines.push(`FROM ${baseContextName} AS ${serviceName}-build`);
    lines.push("");

    // Install OS packages if specified
    if (build.packages && build.packages.length > 0) {
      const packages = build.packages.join(" ");
      lines.push("RUN apk add --no-cache " + packages);
      lines.push("");
    }

    // Copy source files - use ENV variables inherited from base image
    // $$ escapes the $ for HCL interpolation in dockerfile-inline
    lines.push("COPY --chown=$${NOPO_APP_UID}:$${NOPO_APP_GID} . .");
    lines.push("");

    // Set build environment variables
    if (build.env && Object.keys(build.env).length > 0) {
      for (const [key, value] of Object.entries(build.env)) {
        lines.push(`ENV ${key}=${this.escapeDockerEnvValue(value)}`);
      }
      lines.push("");
    }

    // Run build command
    lines.push(`RUN ${build.command}`);
    lines.push("");

    // Final stage - use context name directly instead of ARG
    lines.push(`FROM ${baseContextName} AS ${serviceName}`);
    lines.push("");
    lines.push("ARG SERVICE_NAME");
    lines.push("");

    // Copy only the specified output paths, or fallback to copying everything
    // $$ escapes the $ for HCL interpolation in dockerfile-inline
    // Output paths are relative to the service directory, so we need to include
    // the relative service path (e.g., "apps/web/build" instead of just "build")
    if (build.output && build.output.length > 0) {
      for (const outputPath of build.output) {
        // Construct the full path: service relative path + output path
        const fullOutputPath = path.posix.join(relativeServicePath, outputPath);
        lines.push(
          `COPY --from=${serviceName}-build --chown=$\${NOPO_APP_UID}:$\${NOPO_APP_GID} $\${APP}/${fullOutputPath} $\${APP}/${fullOutputPath}`,
        );
      }
      // Also copy the home directory for dependencies
      lines.push(
        `COPY --from=${serviceName}-build --chown=$\${NOPO_APP_UID}:$\${NOPO_APP_GID} $\${HOME} $\${HOME}`,
      );
    } else {
      // No output specified - copy everything (like traditional Dockerfile)
      lines.push(
        `COPY --from=${serviceName}-build --chown=$\${NOPO_APP_UID}:$\${NOPO_APP_GID} $\${APP} $\${APP}`,
      );
      lines.push(
        `COPY --from=${serviceName}-build --chown=$\${NOPO_APP_UID}:$\${NOPO_APP_GID} $\${HOME} $\${HOME}`,
      );
    }
    lines.push("");

    // Set service name environment variable
    // $$ escapes the $ for HCL interpolation in dockerfile-inline
    lines.push("ENV SERVICE_NAME=$${SERVICE_NAME}");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Escape a value for use in a Dockerfile ENV statement.
   * Wraps values containing spaces in quotes.
   */
  private escapeDockerEnvValue(value: string): string {
    if (value.includes(" ") || value.includes("$") || value.includes('"')) {
      // Escape quotes and wrap in quotes
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  private async runBake(
    bakeFile: string,
    targets: string[],
    noCache: boolean,
  ): Promise<string> {
    const commandOptions = ["-f", bakeFile, "--debug", "--progress=plain"];

    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";
    const builder = await this.builder();

    const metadataFile =
      this.runner.config.processEnv.DOCKER_METADATA_FILE ||
      tmpfile("bake-metadata.json", "{}");

    this.log(`
      Building targets: ${targets.length > 0 ? targets.join(", ") : "all"}
      - builder: "${builder ?? "(current context default)"}"
      - push: "${push}"
      - no-cache: "${noCache}"
      - metadata-file: "${metadataFile}"
    `);

    if (builder) {
      commandOptions.push("--builder", builder);
    }
    commandOptions.push("--metadata-file", metadataFile);
    if (push) commandOptions.push("--push");
    if (noCache) commandOptions.push("--no-cache");

    await this.bake(...commandOptions, "--print");
    await this.bake(...commandOptions);

    return metadataFile;
  }

  private serviceEnvKey(service: string): string {
    return `${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}${SERVICE_IMAGE_SUFFIX}`;
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

  private getRootBuildArgs() {
    const { base, dependencies, user } = this.runner.config.project.os;
    const packages = this.formatOsPackages(dependencies);
    const userHome = user.home || "/home/nopoapp";
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
    const names = Object.keys(deps);
    if (names.length === 0) return "";
    return names.join(" ");
  }

  private getPlatforms(): string[] {
    const platformsEnv =
      this.runner.config.processEnv.DOCKER_PLATFORMS || DEFAULT_PLATFORMS;
    return platformsEnv.split(",").map((p) => p.trim());
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

  private writeEmptyOutput(outputPath: string) {
    const resolvedPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(this.runner.config.root, outputPath);
    fs.writeFileSync(resolvedPath, "[]", "utf-8");
    this.log(`Empty build info written to: ${resolvedPath}`);
  }

  private async outputBuildInfo(targets: string[], outputPath?: string) {
    const push = this.runner.config.processEnv.DOCKER_PUSH === "true";
    const env = this.runner.environment.env;
    const configTargets = this.runner.config.targets;
    const rootName = this.runner.config.project.rootName;

    const allTargets = [rootName, ...configTargets];
    const builtTargets = targets.length > 0 ? targets : allTargets;

    const images: Array<{
      name: string;
      tag: string;
      registry: string;
      image: string;
      version: string;
      digest: string | null;
    }> = [];

    if (builtTargets.includes(rootName)) {
      const rootDigest = push
        ? await this.getImageDigest(env.DOCKER_TAG)
        : null;
      images.push({
        name: rootName,
        tag: env.DOCKER_TAG,
        registry: env.DOCKER_REGISTRY,
        image: env.DOCKER_IMAGE,
        version: env.DOCKER_VERSION,
        digest: rootDigest,
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
