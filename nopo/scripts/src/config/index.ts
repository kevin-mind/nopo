import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DEFAULT_DEPENDENCIES: Record<string, string> = {
  "build-essential": "",
  jq: "",
  curl: "",
};

const ServiceInfrastructureSchema = z.object({
  cpu: z.string().default("1"),
  memory: z.string().default("512Mi"),
  port: z.number().int().positive().default(3000),
  min_instances: z.number().int().nonnegative().default(0),
  max_instances: z.number().int().nonnegative().default(10),
  has_database: z.boolean().default(false),
  run_migrations: z.boolean().default(false),
});

// Command dependency specification:
// - Array of strings: ["backend", "worker"] -> same command on each service
// - Object with arrays: { backend: ["build", "clean"] } -> specific commands per service
// - Empty object {} -> no dependencies (overrides service-level)
const CommandDependenciesSchema = z.union([
  z.array(z.string().min(1)),
  z.record(z.string().min(1), z.array(z.string().min(1))),
]).optional();

// Sub-sub-command schema (deepest level - no further nesting)
const SubSubCommandSchema = z.object({
  command: z.string().min(1),
  dependencies: z.never().optional(), // Explicitly disallow dependencies
}).strict();

// Sub-command schema (can have sub-sub-commands)
const SubCommandSchema = z.object({
  command: z.string().min(1).optional(),
  commands: z.record(z.string().min(1), SubSubCommandSchema).optional(),
  dependencies: z.never().optional(), // Explicitly disallow dependencies
}).refine((data) => {
  // Must have either command or commands, not both
  const hasCommand = !!data.command;
  const hasCommands = !!data.commands && Object.keys(data.commands).length > 0;
  if (hasCommand && hasCommands) {
    return false;
  }
  return hasCommand || hasCommands;
}, {
  message: "Cannot specify both 'command' and 'commands'. Use one or the other.",
});

// Top-level command schema
const CommandSchema = z.object({
  command: z.string().min(1).optional(),
  dependencies: CommandDependenciesSchema,
  commands: z.record(z.string().min(1), SubCommandSchema).optional(),
}).refine((data) => {
  // Must have either command or commands, not both
  const hasCommand = !!data.command;
  const hasCommands = !!data.commands && Object.keys(data.commands).length > 0;
  if (hasCommand && hasCommands) {
    return false;
  }
  return hasCommand || hasCommands;
}, {
  message: "Cannot specify both 'command' and 'commands'. Use one or the other.",
});

const CommandsSchema = z.record(z.string().min(1), CommandSchema).default({});

// Service-level dependencies (simple array of service names)
const ServiceDependenciesSchema = z.array(z.string().min(1)).default([]);

const ServiceFileSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    dockerfile: z.string().optional(),
    image: z.string().optional(),
    static_path: z.string().default("build"),
    infrastructure: ServiceInfrastructureSchema.default({}),
    dependencies: ServiceDependenciesSchema,
    commands: CommandsSchema,
  })
  .passthrough()
  .refine((data) => data.dockerfile || data.image, {
    message: "Either 'dockerfile' or 'image' must be specified",
  })
  .refine((data) => !(data.dockerfile && data.image), {
    message: "Cannot specify both 'dockerfile' and 'image'",
  });

const ServicesSchema = z.object({
  dir: z.string().default("./apps"),
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

const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  os: ProjectOsSchema.default({
    base: "node:22.16.0-slim",
  }),
  services: ServicesSchema.default({ dir: "./apps" }),
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

// Sub-command (no dependencies allowed)
export interface NormalizedSubCommand {
  command: string;
  commands?: Record<string, NormalizedSubCommand>;
}

export interface NormalizedCommand {
  command?: string;
  dependencies?: CommandDependencies;
  commands?: Record<string, NormalizedSubCommand>;
}

export interface NormalizedService {
  id: string;
  name: string;
  description: string;
  staticPath: string;
  infrastructure: NormalizedServiceResources;
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
  dir: string;
  entries: Record<string, NormalizedService>;
  targets: string[];
}

export interface NormalizedProjectConfig {
  name: string;
  configPath: string;
  os: NormalizedOsConfig;
  services: NormalizedServicesConfig;
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
  const services = normalizeServices(parsed.services, resolvedRoot);

  return {
    name: parsed.name,
    configPath: resolvedConfigPath,
    os: normalizeOs(parsed.os),
    services,
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
): NormalizedServicesConfig {
  const entries: Record<string, NormalizedService> = {};
  const dir = path.resolve(rootDir, servicesConfig.dir);

  if (!fs.existsSync(dir)) {
    throw new Error(
      `Configured services.dir "${servicesConfig.dir}" does not exist (resolved to ${dir}).`,
    );
  }

  discoverServices(dir, entries, rootDir);
  const targets = Object.keys(entries).sort();

  return {
    dir,
    entries,
    targets,
  };
}

function discoverServices(
  servicesDir: string,
  entries: Record<string, NormalizedService>,
  projectRoot: string,
): void {
  const children = fs.readdirSync(servicesDir, { withFileTypes: true });

  for (const child of children) {
    if (!child.isDirectory()) continue;
    const serviceId = child.name;
    const serviceRoot = path.join(servicesDir, serviceId);
    const serviceConfigPath = path.join(serviceRoot, "nopo.yml");

    if (!fs.existsSync(serviceConfigPath)) {
      throw new Error(
        `Missing nopo.yml in ${serviceRoot}. Each service directory must define its own config.`,
      );
    }

    const serviceDocument = parseYamlFile(serviceConfigPath);
    const parsed = ServiceFileSchema.parse(serviceDocument);
    const infrastructure = normalizeInfrastructure(parsed.infrastructure);
    const commands = normalizeCommands(parsed.commands);

    const normalized: NormalizedService = {
      id: serviceId,
      name: parsed.name ?? serviceId,
      description: parsed.description ?? "",
      staticPath: parsed.static_path,
      infrastructure,
      configPath: serviceConfigPath,
      image: parsed.image,
      dependencies: parsed.dependencies,
      commands,
      paths: {
        root: serviceRoot,
        dockerfile: parsed.dockerfile
          ? path.resolve(serviceRoot, parsed.dockerfile)
          : undefined,
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

function normalizeSubCommands(
  commands: Record<string, SubCommandInput> | undefined,
  parentPath: string,
): Record<string, NormalizedSubCommand> | undefined {
  if (!commands) return undefined;

  const result: Record<string, NormalizedSubCommand> = {};

  for (const [name, cmd] of Object.entries(commands)) {
    // Check if subcommand has dependencies (not allowed)
    if ('dependencies' in cmd && (cmd as { dependencies?: unknown }).dependencies) {
      throw new Error(
        `Subcommands cannot define dependencies. Found at '${parentPath}:${name}'.`
      );
    }

    if (cmd.command) {
      result[name] = { command: cmd.command };
    } else if (cmd.commands) {
      // Recursive for sub-sub-commands
      result[name] = {
        command: undefined as unknown as string, // Will be populated with subcommands
        commands: normalizeSubSubCommands(cmd.commands, `${parentPath}:${name}`),
      };
    }
  }

  return result;
}

function normalizeSubSubCommands(
  commands: Record<string, { command: string }> | undefined,
  parentPath: string,
): Record<string, NormalizedSubCommand> | undefined {
  if (!commands) return undefined;

  const result: Record<string, NormalizedSubCommand> = {};

  for (const [name, cmd] of Object.entries(commands)) {
    result[name] = { command: cmd.command };
  }

  return result;
}

function normalizeCommands(
  commands: CommandsInput,
): Record<string, NormalizedCommand> {
  const result: Record<string, NormalizedCommand> = {};

  for (const [name, cmd] of Object.entries(commands)) {
    if (cmd.command) {
      result[name] = {
        command: cmd.command,
        dependencies: cmd.dependencies,
      };
    } else if (cmd.commands) {
      result[name] = {
        dependencies: cmd.dependencies,
        commands: normalizeSubCommands(cmd.commands, name),
      };
    }
  }

  return result;
}
