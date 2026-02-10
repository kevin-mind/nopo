import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DEFAULT_DEPENDENCIES: Record<string, string> = {
  "build-essential": "",
  jq: "",
  curl: "",
};

// Target type: "service" if it has runtime config, "package" if build-only
export type TargetType = "package" | "service";

// Command dependency specification:
// - Array of strings: ["backend", "worker"] -> same command on each service
// - Object with arrays: { backend: ["build", "clean"] } -> specific commands per service
// - Empty object {} -> no dependencies (overrides service-level)
const CommandDependenciesSchema = z
  .union([
    z.array(z.string().min(1)),
    z.record(z.string().min(1), z.array(z.string().min(1))),
  ])
  .optional();

// Runtime configuration for services
// A target is a "service" if it has runtime config, otherwise it's a "package"
const ServiceRuntimeSchema = z.object({
  command: z.string().optional(),
  cpu: z.string().default("1"),
  memory: z.string().default("512Mi"),
  port: z.number().int().positive().default(3000),
  min_instances: z.number().int().nonnegative().default(0),
  max_instances: z.number().int().nonnegative().default(10),
  has_database: z.boolean().default(false),
  run_migrations: z.boolean().default(false),
  depends_on: CommandDependenciesSchema,
});

// Build configuration for services and packages
const ServiceBuildSchema = z.object({
  command: z.string().optional(),
  // output can be a single string or array of strings (paths to include in final image)
  output: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      return Array.isArray(val) ? val : [val];
    }),
  dockerfile: z.string().optional(),
  packages: z.array(z.string()).optional(), // OS packages to install
  env: z.record(z.string()).optional(),
  depends_on: CommandDependenciesSchema,
});

// Environment variables for commands
const CommandEnvSchema = z.record(z.string().min(1), z.string()).optional();

// Working directory for commands: absolute path, relative to service, or "root"
const CommandDirSchema = z.string().optional();

// Execution context for commands: host (default) or container
const CommandContextSchema = z.enum(["host", "container"]).optional();

// Sub-sub-command schema (deepest level - no further nesting)
// Supports shorthand: "pnpm build" or full object { command: "pnpm build", env: {...}, dir: "...", context: "..." }
const SubSubCommandObjectSchema = z.object({
  command: z.string().min(1),
  env: CommandEnvSchema,
  dir: CommandDirSchema,
  context: CommandContextSchema,
  dependencies: z.never().optional(), // Explicitly disallow dependencies
});

const SubSubCommandSchema = z.union([
  z
    .string()
    .min(1)
    .transform((cmd) => ({
      command: cmd,
      env: undefined,
      dir: undefined,
      context: undefined,
    })),
  SubSubCommandObjectSchema,
]);

// Sub-command schema (can have sub-sub-commands)
// Supports shorthand: "pnpm build" or full object
const SubCommandObjectSchema = z
  .object({
    command: z.string().min(1).optional(),
    env: CommandEnvSchema,
    dir: CommandDirSchema,
    context: CommandContextSchema,
    commands: z.record(z.string().min(1), SubSubCommandSchema).optional(),
    dependencies: z.never().optional(), // Explicitly disallow dependencies
  })
  .refine(
    (data) => {
      // Must have either command or commands, not both
      const hasCommand = !!data.command;
      const hasCommands =
        !!data.commands && Object.keys(data.commands).length > 0;
      if (hasCommand && hasCommands) {
        return false;
      }
      return hasCommand || hasCommands;
    },
    {
      message:
        "Cannot specify both 'command' and 'commands'. Use one or the other.",
    },
  );

const SubCommandSchema = z.union([
  z
    .string()
    .min(1)
    .transform((cmd) => ({
      command: cmd,
      env: undefined,
      dir: undefined,
      context: undefined,
      commands: undefined,
    })),
  SubCommandObjectSchema,
]);

// Top-level command schema
// Supports shorthand: "pnpm build" or full object
const CommandObjectSchema = z
  .object({
    command: z.string().min(1).optional(),
    env: CommandEnvSchema,
    dir: CommandDirSchema,
    context: CommandContextSchema,
    dependencies: CommandDependenciesSchema,
    commands: z.record(z.string().min(1), SubCommandSchema).optional(),
  })
  .refine(
    (data) => {
      // Must have either command or commands, not both
      const hasCommand = !!data.command;
      const hasCommands =
        !!data.commands && Object.keys(data.commands).length > 0;
      if (hasCommand && hasCommands) {
        return false;
      }
      return hasCommand || hasCommands;
    },
    {
      message:
        "Cannot specify both 'command' and 'commands'. Use one or the other.",
    },
  );

const CommandSchema = z.union([
  z
    .string()
    .min(1)
    .transform((cmd) => ({
      command: cmd,
      env: undefined,
      dir: undefined,
      context: undefined,
      dependencies: undefined,
      commands: undefined,
    })),
  CommandObjectSchema,
]);

const CommandsSchema = z.record(z.string().min(1), CommandSchema).default({});

// Service-level dependencies (simple array of service names)
const ServiceDependenciesSchema = z.array(z.string().min(1)).default([]);

const ServiceFileSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    // Legacy: top-level dockerfile (now prefer build.dockerfile)
    dockerfile: z.string().optional(),
    image: z.string().optional(),
    static_path: z.string().default("build"),
    // New: build configuration
    build: ServiceBuildSchema.optional(),
    // Runtime configuration (services have this, packages don't)
    runtime: ServiceRuntimeSchema.optional(),
    dependencies: ServiceDependenciesSchema,
    commands: CommandsSchema,
  })
  .passthrough()
  .refine(
    (data) => {
      // Cannot specify both dockerfile and image at top level
      if (data.dockerfile && data.image) return false;
      // Cannot specify both build.dockerfile and top-level dockerfile
      if (data.dockerfile && data.build?.dockerfile) return false;
      return true;
    },
    {
      message:
        "Cannot specify both 'dockerfile' and 'image', or 'dockerfile' at both top-level and in 'build'",
    },
  );

const ServicesSchema = z
  .object({
    dir: z.string().optional(),
    dirs: z.array(z.string().min(1)).optional(),
  })
  .transform((data) => {
    // Support both 'dir' (single) and 'dirs' (multiple)
    if (data.dirs && data.dirs.length > 0) {
      return { dirs: data.dirs };
    }
    return { dirs: [data.dir ?? "./apps"] };
  });

const DependencyVersionSchema = z
  .string()
  .transform((value) => value.trim())
  .optional()
  .default("");

const DependenciesSchema = z
  .union([
    z.record(z.string().min(1), DependencyVersionSchema),
    z.array(z.record(z.string().min(1), DependencyVersionSchema)),
  ])
  .default({})
  .transform((value) => {
    if (Array.isArray(value)) {
      return value.reduce<Record<string, string>>((acc, entry) => {
        for (const [key, val] of Object.entries(entry)) {
          if (key && val) acc[key] = val;
        }
        return acc;
      }, {});
    }
    return value;
  });

const BaseImageSchema = z.union([
  z.string().min(1),
  z.object({
    image: z.string().min(1),
  }),
]);

const ProjectOsSchema = z.object({
  base: BaseImageSchema.default("node:22.16.0-slim"),
  dependencies: DependenciesSchema,
  user: z
    .object({
      uid: z.number().int().nonnegative().default(1001),
      gid: z.number().int().nonnegative().default(1001),
      home: z.string().default("/home/nopo"),
    })
    .default({}),
});

// Root service commands configuration (simplified - no dockerfile/image required)
const RootCommandsSchema = z.object({
  commands: CommandsSchema.default({}),
});

const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  os: ProjectOsSchema.default({
    base: "node:22.16.0-slim",
  }),
  services: ServicesSchema.default({}),
  root_name: z.string().min(1).default("root"),
  root: RootCommandsSchema.optional(),
});

type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
type ServiceRuntimeInput = z.infer<typeof ServiceRuntimeSchema>;
type ServiceBuildInput = z.infer<typeof ServiceBuildSchema>;

// Runtime resources (renamed from infrastructure, with optional command)
interface NormalizedServiceRuntime {
  command?: string;
  cpu: string;
  memory: string;
  port: number;
  minInstances: number;
  maxInstances: number;
  hasDatabase: boolean;
  runMigrations: boolean;
  depends_on?: CommandDependencies;
}

// Build configuration
interface NormalizedServiceBuild {
  command?: string;
  output?: string[];
  dockerfile?: string;
  packages?: string[];
  env?: Record<string, string>;
  depends_on?: CommandDependencies;
}

// Command dependency types
export type CommandDependencies =
  | string[] // Array of service names (same command)
  | Record<string, string[]> // Object with service -> commands mapping
  | undefined;

/**
 * Extract dependency service names from CommandDependencies format.
 * Handles both array format and object format.
 *
 * @param deps - The dependencies to extract names from
 * @returns Array of service names
 *
 * @example
 * extractDependencyNames(['backend', 'db']) // ['backend', 'db']
 * extractDependencyNames({ backend: ['build'], db: ['migrate'] }) // ['backend', 'db']
 * extractDependencyNames(undefined) // []
 */
export function extractDependencyNames(
  deps: CommandDependencies,
): string[] {
  if (!deps) return [];
  if (Array.isArray(deps)) return deps;
  return Object.keys(deps);
}

// Execution context type
export type CommandContext = "host" | "container";

// Sub-command (no dependencies allowed)
export interface NormalizedSubCommand {
  command: string;
  env?: Record<string, string>;
  dir?: string;
  context?: CommandContext;
  commands?: Record<string, NormalizedSubCommand>;
}

export interface NormalizedCommand {
  command?: string;
  env?: Record<string, string>;
  dir?: string;
  context?: CommandContext;
  dependencies?: CommandDependencies;
  commands?: Record<string, NormalizedSubCommand>;
}

export interface NormalizedService {
  id: string;
  name: string;
  description: string;
  staticPath: string;
  /** Target type: "service" (has runtime) or "package" (build-only, no runtime) */
  type: TargetType;
  /** Build configuration */
  build?: NormalizedServiceBuild;
  /** Runtime configuration (services only, packages have undefined) */
  runtime?: NormalizedServiceRuntime;
  configPath: string;
  image?: string;
  dependencies: string[];
  commands: Record<string, NormalizedCommand>;
  paths: {
    root: string;
    dockerfile?: string;
    context: string;
  };
}

interface BuildableService extends NormalizedService {
  paths: {
    root: string;
    dockerfile: string;
    context: string;
  };
}

/**
 * Service that can generate a virtual Dockerfile from build config.
 * Has build.command or build.output but no dockerfile.
 */
export interface VirtualBuildableService extends NormalizedService {
  build: NormalizedServiceBuild & {
    command: string; // Must have build command for virtual dockerfile
  };
  paths: {
    root: string;
    dockerfile: undefined;
    context: string;
  };
}

/**
 * Check if a service uses a physical Dockerfile.
 */
export function isBuildableService(
  service: NormalizedService,
): service is BuildableService {
  return service.paths.dockerfile !== undefined;
}

/**
 * Check if a service can generate a virtual inline Dockerfile.
 * Services without dockerfile but with build.command can use virtual Dockerfiles.
 */
export function isVirtualBuildableService(
  service: NormalizedService,
): service is VirtualBuildableService {
  return (
    service.paths.dockerfile === undefined &&
    service.build?.command !== undefined
  );
}

/**
 * Check if a service requires building (either physical or virtual Dockerfile).
 */
export function requiresBuild(service: NormalizedService): boolean {
  return isBuildableService(service) || isVirtualBuildableService(service);
}

/**
 * Check if a service is a package (build-only, no runtime).
 * Packages don't have runtime configuration and don't run as containers.
 */
export function isPackageService(service: NormalizedService): boolean {
  return service.type === "package";
}

/**
 * Check if a service is a runnable service (has runtime configuration).
 * Services have runtime concerns like ports, scaling, and databases.
 */
export function isRunnableService(service: NormalizedService): boolean {
  return service.type === "service";
}

interface NormalizedOsConfig {
  base: {
    from: string;
  };
  dependencies: Record<string, string>;
  user: {
    uid: number;
    gid: number;
    home: string;
  };
}

interface NormalizedServicesConfig {
  dirs: string[];
  entries: Record<string, NormalizedService>;
  targets: string[];
}

export interface NormalizedProjectConfig {
  name: string;
  configPath: string;
  os: NormalizedOsConfig;
  services: NormalizedServicesConfig;
  rootName: string;
}

export function loadProjectConfig(
  rootDir: string,
  configPath?: string,
): NormalizedProjectConfig {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedConfigPath = configPath
    ? path.resolve(configPath)
    : path.join(resolvedRoot, "nopo.yml");

  if (!fs.existsSync(resolvedConfigPath)) {
    throw new Error(
      `Missing nopo.yml configuration at ${resolvedConfigPath}. Add one to continue.`,
    );
  }

  const document = parseYamlFile(resolvedConfigPath);
  const parsed = ProjectConfigSchema.parse(document);
  const rootName = parsed.root_name;
  const rootCommands = parsed.root
    ? normalizeCommands(parsed.root.commands)
    : {};
  const services = normalizeServices(
    parsed.services,
    resolvedRoot,
    rootName,
    rootCommands,
    resolvedConfigPath,
  );

  return {
    name: parsed.name,
    configPath: resolvedConfigPath,
    os: normalizeOs(parsed.os),
    services,
    rootName,
  };
}

function parseYamlFile(filePath: string): unknown {
  try {
    const contents = fs.readFileSync(filePath, "utf-8");
    return contents ? (parseYaml(contents) ?? {}) : {};
  } catch (error) {
    throw new Error(
      `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeOs(osConfig: ProjectConfig["os"]): NormalizedOsConfig {
  const base = normalizeBaseImage(osConfig.base);
  return {
    base,
    dependencies: {
      ...DEFAULT_DEPENDENCIES,
      ...osConfig.dependencies,
    },
    user: {
      uid: osConfig.user.uid,
      gid: osConfig.user.gid,
      home: osConfig.user.home,
    },
  };
}

function normalizeBaseImage(
  base: ProjectConfig["os"]["base"],
): NormalizedOsConfig["base"] {
  const fromImage = typeof base === "string" ? base : base.image;
  return { from: fromImage };
}

/**
 * Resolve directory patterns to actual directories.
 * Supports glob patterns (e.g., "./apps/*") and exclusion patterns (prefixed with "!").
 *
 * @param patterns - Array of directory patterns, where patterns prefixed with "!" are exclusions
 * @param rootDir - The project root directory for resolving relative paths
 * @returns Array of resolved, unique directory paths
 */
function resolveDirectoryPatterns(
  patterns: string[],
  rootDir: string,
): string[] {
  const includeDirs = new Set<string>();
  const excludePatterns: string[] = [];

  // Separate include patterns from exclude patterns
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      // Exclusion pattern - store for later filtering
      excludePatterns.push(pattern.slice(1));
    } else {
      // Include pattern - could be literal path or glob
      const isGlobPattern =
        pattern.includes("*") || pattern.includes("?") || pattern.includes("[");

      if (isGlobPattern) {
        // Use glob to expand pattern
        // Use mark: true to add trailing slash to directories, then filter
        const matches = globSync(pattern, {
          cwd: rootDir,
          absolute: true,
          mark: true,
        });
        for (const match of matches) {
          // Only include directories (marked with trailing slash)
          if (match.endsWith("/")) {
            includeDirs.add(match.slice(0, -1)); // Remove trailing slash
          } else if (fs.existsSync(match) && fs.statSync(match).isDirectory()) {
            // Fallback: check if it's a directory without trailing slash
            includeDirs.add(match);
          }
        }
      } else {
        // Literal directory path
        const resolvedDir = path.resolve(rootDir, pattern);
        if (!fs.existsSync(resolvedDir)) {
          throw new Error(
            `Configured services.dir "${pattern}" does not exist (resolved to ${resolvedDir}).`,
          );
        }
        includeDirs.add(resolvedDir);
      }
    }
  }

  // Apply exclusion patterns
  if (excludePatterns.length > 0) {
    const excludeDirs = new Set<string>();
    for (const pattern of excludePatterns) {
      const isGlobPattern =
        pattern.includes("*") || pattern.includes("?") || pattern.includes("[");

      if (isGlobPattern) {
        // Use mark: true to add trailing slash to directories, then filter
        const matches = globSync(pattern, {
          cwd: rootDir,
          absolute: true,
          mark: true,
        });
        for (const match of matches) {
          // Only include directories (marked with trailing slash)
          if (match.endsWith("/")) {
            excludeDirs.add(match.slice(0, -1)); // Remove trailing slash
          } else if (fs.existsSync(match) && fs.statSync(match).isDirectory()) {
            // Fallback: check if it's a directory without trailing slash
            excludeDirs.add(match);
          }
        }
      } else {
        excludeDirs.add(path.resolve(rootDir, pattern));
      }
    }

    // Remove excluded directories
    for (const dir of excludeDirs) {
      includeDirs.delete(dir);
    }
  }

  return Array.from(includeDirs).sort();
}

function normalizeServices(
  servicesConfig: ProjectConfig["services"],
  rootDir: string,
  rootName: string,
  rootCommands: Record<string, NormalizedCommand>,
  rootConfigPath: string,
): NormalizedServicesConfig {
  const entries: Record<string, NormalizedService> = {};

  // Resolve directory patterns (including globs and exclusions)
  const resolvedDirs = resolveDirectoryPatterns(servicesConfig.dirs, rootDir);

  // Discover services in each resolved directory
  for (const servicesDir of resolvedDirs) {
    discoverServices(servicesDir, entries, rootDir, rootName);
  }

  // Add the root service if it has commands
  if (Object.keys(rootCommands).length > 0) {
    if (entries[rootName]) {
      throw new Error(
        `Service "${rootName}" conflicts with root_name. Use a different root_name in nopo.yml.`,
      );
    }

    entries[rootName] = {
      id: rootName,
      name: "Root",
      description: "Root-level project commands",
      staticPath: "",
      type: "package", // Root is a package (no runtime)
      build: undefined,
      runtime: undefined,
      configPath: rootConfigPath,
      image: undefined,
      dependencies: [],
      commands: rootCommands,
      paths: {
        root: rootDir,
        dockerfile: undefined,
        context: rootDir,
      },
    };
  }

  const targets = Object.keys(entries).sort();

  return {
    dirs: resolvedDirs,
    entries,
    targets,
  };
}

function discoverServices(
  servicesDir: string,
  entries: Record<string, NormalizedService>,
  projectRoot: string,
  rootName: string,
): void {
  const children = fs.readdirSync(servicesDir, { withFileTypes: true });

  for (const child of children) {
    if (!child.isDirectory()) continue;
    const serviceId = child.name;
    const serviceRoot = path.join(servicesDir, serviceId);
    const serviceConfigPath = path.join(serviceRoot, "nopo.yml");

    // Skip directories without nopo.yml - they are not nopo services
    if (!fs.existsSync(serviceConfigPath)) {
      continue;
    }

    const serviceDocument = parseYamlFile(serviceConfigPath);
    const parsed = ServiceFileSchema.parse(serviceDocument);
    const commands = normalizeCommands(parsed.commands);

    // Validate that root cannot be in top-level service dependencies
    if (parsed.dependencies.includes(rootName)) {
      throw new Error(
        `Service "${serviceId}" cannot depend on "${rootName}" at service level. ` +
          `Root can only be specified in command-level dependencies.`,
      );
    }

    // Normalize runtime configuration
    const runtime = normalizeRuntime(parsed.runtime);

    // Normalize build configuration
    const build = normalizeBuild(parsed.build, parsed.dockerfile);

    // A target is a "service" if it has runtime configuration or image, otherwise it's a "package"
    const targetType: TargetType =
      parsed.runtime || parsed.image ? "service" : "package";

    // Determine dockerfile path (prefer build.dockerfile over legacy top-level)
    const dockerfilePath =
      (build?.dockerfile ?? parsed.dockerfile)
        ? path.resolve(serviceRoot, build?.dockerfile ?? parsed.dockerfile!)
        : undefined;

    // Merge dependencies from all sources for backward compatibility:
    // 1. Top-level service dependencies (legacy)
    // 2. Runtime dependencies (new runtime.depends_on field)
    // 3. Build dependencies (new build.depends_on field)
    const allDependencies = new Set([
      ...parsed.dependencies,
      ...extractDependencyNames(runtime?.depends_on),
      ...extractDependencyNames(build?.depends_on),
    ]);

    const normalized: NormalizedService = {
      id: serviceId,
      name: parsed.name ?? serviceId,
      description: parsed.description ?? "",
      staticPath: parsed.static_path,
      type: targetType,
      build,
      runtime,
      configPath: serviceConfigPath,
      image: parsed.image,
      dependencies: Array.from(allDependencies),
      commands,
      paths: {
        root: serviceRoot,
        dockerfile: dockerfilePath,
        context: projectRoot,
      },
    };

    if (entries[serviceId]) {
      const existingPath = entries[serviceId]!.configPath;
      throw new Error(
        `Duplicate service "${serviceId}" found at "${serviceConfigPath}". ` +
          `A service with this ID already exists at "${existingPath}". ` +
          `Service IDs must be unique across all service directories.`,
      );
    }
    entries[serviceId] = normalized;
  }
}

/**
 * Normalize runtime configuration.
 */
function normalizeRuntime(
  runtime: ServiceRuntimeInput | undefined,
): NormalizedServiceRuntime | undefined {
  if (!runtime) {
    return undefined;
  }

  return {
    command: runtime.command,
    cpu: runtime.cpu,
    memory: runtime.memory,
    port: runtime.port,
    minInstances: runtime.min_instances,
    maxInstances: runtime.max_instances,
    hasDatabase: runtime.has_database,
    runMigrations: runtime.run_migrations,
    depends_on: runtime.depends_on,
  };
}

/**
 * Normalize build configuration.
 */
function normalizeBuild(
  build: ServiceBuildInput | undefined,
  legacyDockerfile: string | undefined,
): NormalizedServiceBuild | undefined {
  // If no build config but has legacy dockerfile, create minimal build config
  if (!build && legacyDockerfile) {
    return {
      dockerfile: legacyDockerfile,
    };
  }

  if (!build) {
    return undefined;
  }

  return {
    command: build.command,
    output: build.output, // Already transformed to array by schema
    dockerfile: build.dockerfile,
    packages: build.packages,
    env: build.env,
    depends_on: build.depends_on,
  };
}

type CommandsInput = z.infer<typeof CommandsSchema>;
type SubCommandInput = z.infer<typeof SubCommandSchema>;
type SubSubCommandInput = z.infer<typeof SubSubCommandSchema>;

function normalizeSubCommands(
  commands: Record<string, SubCommandInput> | undefined,
  parentPath: string,
): Record<string, NormalizedSubCommand> | undefined {
  if (!commands) return undefined;

  const result: Record<string, NormalizedSubCommand> = {};

  for (const [name, cmd] of Object.entries(commands)) {
    // Check if subcommand has dependencies (not allowed)
    if (
      "dependencies" in cmd &&
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowing union type that doesn't share 'dependencies' property
      (cmd as { dependencies?: unknown }).dependencies
    ) {
      throw new Error(
        `Subcommands cannot define dependencies. Found at '${parentPath}:${name}'.`,
      );
    }

    if (cmd.command) {
      result[name] = {
        command: cmd.command,
        env: cmd.env,
        dir: cmd.dir,
        context: cmd.context,
      };
    } else if (cmd.commands) {
      // Recursive for sub-sub-commands
      result[name] = {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- command is optional when subcommands exist, but interface requires string
        command: undefined as unknown as string, // Will be populated with subcommands
        env: cmd.env,
        dir: cmd.dir,
        context: cmd.context,
        commands: normalizeSubSubCommands(cmd.commands),
      };
    }
  }

  return result;
}

function normalizeSubSubCommands(
  commands: Record<string, SubSubCommandInput> | undefined,
): Record<string, NormalizedSubCommand> | undefined {
  if (!commands) return undefined;

  const result: Record<string, NormalizedSubCommand> = {};

  for (const [name, cmd] of Object.entries(commands)) {
    result[name] = {
      command: cmd.command,
      env: cmd.env,
      dir: cmd.dir,
      context: cmd.context,
    };
  }

  return result;
}

// Reserved command names that match nopo built-in scripts
const RESERVED_COMMAND_NAMES = [
  "build",
  "command",
  "down",
  "env",
  "list",
  "pull",
  "status",
  "up",
];

function normalizeCommands(
  commands: CommandsInput,
): Record<string, NormalizedCommand> {
  const result: Record<string, NormalizedCommand> = {};

  for (const [name, cmd] of Object.entries(commands)) {
    // Validate that command names don't conflict with nopo built-in scripts
    if (RESERVED_COMMAND_NAMES.includes(name)) {
      throw new Error(
        `Command name '${name}' is reserved for nopo built-in scripts. Please use a different name.`,
      );
    }

    if (cmd.command) {
      result[name] = {
        command: cmd.command,
        env: cmd.env,
        dir: cmd.dir,
        context: cmd.context,
        dependencies: cmd.dependencies,
      };
    } else if (cmd.commands) {
      result[name] = {
        env: cmd.env,
        dir: cmd.dir,
        context: cmd.context,
        dependencies: cmd.dependencies,
        commands: normalizeSubCommands(cmd.commands, name),
      };
    }
  }

  return result;
}
