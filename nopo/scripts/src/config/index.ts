import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DEFAULT_DEPENDENCIES: Record<string, string> = {
  "build-essential": "",
  jq: "",
  curl: "",
};

// Runtime configuration (previously called infrastructure)
// Supports both "runtime" (preferred) and "infrastructure" (deprecated) keys
const ServiceRuntimeSchema = z.object({
  cpu: z.string().default("1"),
  memory: z.string().default("512Mi"),
  port: z.number().int().positive().default(3000),
  min_instances: z.number().int().nonnegative().default(0),
  max_instances: z.number().int().nonnegative().default(10),
  has_database: z.boolean().default(false),
  run_migrations: z.boolean().default(false),
});

// Alias for backward compatibility
const ServiceInfrastructureSchema = ServiceRuntimeSchema;

// Build configuration for services/packages
// - dockerfile: Path to Dockerfile (for services)
// - command: Build command to run (for packages or services without Docker)
// - output: Build output path(s) - string or array of strings
// - packages: Workspace packages to include in Docker build
// - env: Environment variables for the build
const ServiceBuildSchema = z
  .object({
    dockerfile: z.string().optional(),
    command: z.string().optional(),
    output: z
      .union([z.string(), z.array(z.string().min(1))])
      .optional()
      .transform((val) => {
        if (val === undefined) return undefined;
        return Array.isArray(val) ? val : [val];
      }),
    packages: z.array(z.string().min(1)).optional(),
    env: z.record(z.string().min(1), z.string()).optional(),
  })
  .optional();

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
    // Legacy field - prefer build.dockerfile
    dockerfile: z.string().optional(),
    image: z.string().optional(),
    static_path: z.string().default("build"),
    // Support both "runtime" (preferred) and "infrastructure" (deprecated)
    runtime: ServiceRuntimeSchema.optional(),
    infrastructure: ServiceInfrastructureSchema.optional(),
    // Build configuration
    build: ServiceBuildSchema,
    dependencies: ServiceDependenciesSchema,
    commands: CommandsSchema,
  })
  .passthrough()
  .transform((data) => {
    // Merge runtime and infrastructure (runtime takes precedence)
    const runtimeConfig = data.runtime ?? data.infrastructure ?? {};

    // Emit deprecation warning for "infrastructure" key
    if (data.infrastructure && !data.runtime) {
      console.warn(
        `[nopo] Deprecation warning: 'infrastructure' is deprecated. Use 'runtime' instead.`,
      );
    }

    // Emit deprecation warning for top-level "dockerfile" when build.dockerfile should be used
    if (data.dockerfile && !data.build?.dockerfile) {
      console.warn(
        `[nopo] Deprecation warning: Top-level 'dockerfile' is deprecated. Use 'build.dockerfile' instead.`,
      );
    }

    return {
      ...data,
      // Normalized runtime from either source
      _normalizedRuntime: ServiceRuntimeSchema.parse(runtimeConfig),
    };
  })
  .refine(
    (data) => {
      // Cannot specify both dockerfile and image
      const dockerfile = data.build?.dockerfile ?? data.dockerfile;
      return !(dockerfile && data.image);
    },
    {
      message: "Cannot specify both 'dockerfile' and 'image'",
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
type ServiceInfrastructureInput = z.infer<typeof ServiceInfrastructureSchema>;

interface NormalizedServiceResources {
  cpu: string;
  memory: string;
  port: number;
  minInstances: number;
  maxInstances: number;
  hasDatabase: boolean;
  runMigrations: boolean;
}

// Command dependency types
export type CommandDependencies =
  | string[] // Array of service names (same command)
  | Record<string, string[]> // Object with service -> commands mapping
  | undefined;

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

// Build configuration for a normalized service
export interface NormalizedBuild {
  dockerfile?: string;
  command?: string;
  output?: string[];
  packages?: string[];
  env?: Record<string, string>;
}

export interface NormalizedService {
  id: string;
  name: string;
  description: string;
  staticPath: string;
  /** @deprecated Use runtime instead */
  infrastructure: NormalizedServiceResources;
  runtime: NormalizedServiceResources;
  configPath: string;
  image?: string;
  dependencies: string[];
  commands: Record<string, NormalizedCommand>;
  /** Whether this is a package (no Docker) or a service (has Docker) */
  isPackage: boolean;
  build?: NormalizedBuild;
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

export function isBuildableService(
  service: NormalizedService,
): service is BuildableService {
  return service.paths.dockerfile !== undefined;
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

function normalizeServices(
  servicesConfig: ProjectConfig["services"],
  rootDir: string,
  rootName: string,
  rootCommands: Record<string, NormalizedCommand>,
  rootConfigPath: string,
): NormalizedServicesConfig {
  const entries: Record<string, NormalizedService> = {};
  const resolvedDirs: string[] = [];

  for (const dir of servicesConfig.dirs) {
    const resolvedDir = path.resolve(rootDir, dir);

    if (!fs.existsSync(resolvedDir)) {
      throw new Error(
        `Configured services.dir "${dir}" does not exist (resolved to ${resolvedDir}).`,
      );
    }

    resolvedDirs.push(resolvedDir);
    discoverServices(resolvedDir, entries, rootDir, rootName);
  }

  // Add the root service if it has commands
  if (Object.keys(rootCommands).length > 0) {
    if (entries[rootName]) {
      throw new Error(
        `Service "${rootName}" conflicts with root_name. Use a different root_name in nopo.yml.`,
      );
    }

    const rootRuntime = {
      cpu: "1",
      memory: "512Mi",
      port: 3000,
      minInstances: 0,
      maxInstances: 0,
      hasDatabase: false,
      runMigrations: false,
    };

    entries[rootName] = {
      id: rootName,
      name: "Root",
      description: "Root-level project commands",
      staticPath: "",
      infrastructure: rootRuntime,
      runtime: rootRuntime,
      configPath: rootConfigPath,
      image: undefined,
      dependencies: [],
      commands: rootCommands,
      isPackage: true, // Root is always a package (no Docker)
      build: undefined,
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
    const runtimeResources = normalizeInfrastructure(parsed._normalizedRuntime);
    const commands = normalizeCommands(parsed.commands);

    // Validate that root cannot be in top-level service dependencies
    if (parsed.dependencies.includes(rootName)) {
      throw new Error(
        `Service "${serviceId}" cannot depend on "${rootName}" at service level. ` +
          `Root can only be specified in command-level dependencies.`,
      );
    }

    // Determine dockerfile path: prefer build.dockerfile, fall back to top-level dockerfile
    const dockerfilePath = parsed.build?.dockerfile ?? parsed.dockerfile;
    const resolvedDockerfile = dockerfilePath
      ? path.resolve(serviceRoot, dockerfilePath)
      : undefined;

    // Determine if this is a package or service:
    // - Has dockerfile or image: it's a service
    // - Has only build.command (no dockerfile): it's a package
    const hasDocker = !!(resolvedDockerfile || parsed.image);
    const isPackage = !hasDocker;

    // Build normalized build configuration
    const normalizedBuild: NormalizedBuild | undefined = parsed.build
      ? {
          dockerfile: parsed.build.dockerfile,
          command: parsed.build.command,
          output: parsed.build.output,
          packages: parsed.build.packages,
          env: parsed.build.env,
        }
      : undefined;

    const normalized: NormalizedService = {
      id: serviceId,
      name: parsed.name ?? serviceId,
      description: parsed.description ?? "",
      staticPath: parsed.static_path,
      infrastructure: runtimeResources,
      runtime: runtimeResources,
      configPath: serviceConfigPath,
      image: parsed.image,
      dependencies: parsed.dependencies,
      commands,
      isPackage,
      build: normalizedBuild,
      paths: {
        root: serviceRoot,
        dockerfile: resolvedDockerfile,
        context: projectRoot,
      },
    };

    if (entries[serviceId]) {
      throw new Error(
        `Duplicate service "${serviceId}" found. Service IDs must be unique.`,
      );
    }
    entries[serviceId] = normalized;
  }
}

function normalizeInfrastructure(
  infra: ServiceInfrastructureInput,
): NormalizedServiceResources {
  return {
    cpu: infra.cpu,
    memory: infra.memory,
    port: infra.port,
    minInstances: infra.min_instances,
    maxInstances: infra.max_instances,
    hasDatabase: infra.has_database,
    runMigrations: infra.run_migrations,
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
