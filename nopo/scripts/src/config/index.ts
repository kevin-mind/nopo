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

const ServiceFileSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    dockerfile: z.string().optional(),
    image: z.string().optional(),
    static_path: z.string().default("build"),
    infrastructure: ServiceInfrastructureSchema.default({}),
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

export interface NormalizedService {
  id: string;
  name: string;
  description: string;
  staticPath: string;
  infrastructure: NormalizedServiceResources;
  configPath: string;
  image?: string;
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

    const normalized: NormalizedService = {
      id: serviceId,
      name: parsed.name ?? serviceId,
      description: parsed.description ?? "",
      staticPath: parsed.static_path,
      infrastructure,
      configPath: serviceConfigPath,
      image: parsed.image,
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
