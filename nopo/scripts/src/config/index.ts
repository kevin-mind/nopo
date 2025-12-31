import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { DockerTag } from "../docker-tag.ts";

const DEFAULT_DEPENDENCIES: Record<string, string> = {
  node: "22.16.0",
  pnpm: "9.15.0",
  jq: "1.7.0",
  curl: "8.5.0",
  uv: "0.6.10",
};

const ServiceInfrastructureSchema = z.object({
  cpu: z.string().default("1"),
  memory: z.string().default("512Mi"),
  port: z.number().int().positive().default(3000),
  min_instances: z.number().int().nonnegative().default(0),
  max_instances: z.number().int().nonnegative().default(10),
  has_database: z.boolean().default(false),
  run_migrations: z.boolean().default(false),
  static_path: z.string().default("build"),
});

const ServiceFileSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  dockerfile: z.string().default("Dockerfile"),
  context: z.string().default("../.."),
  route: z.string().optional(),
  infrastructure: ServiceInfrastructureSchema.default({}),
}).passthrough();

const InlineServiceSchema = z.object({
  description: z.string().optional(),
  start: z.string().optional(),
  command: z.string().optional(),
  docker: z.string().optional(),
  ports: z.array(z.string()).default([]),
  volumes: z.array(z.string()).default([]),
  environment: z.record(z.string()).default({}),
  healthcheck: z
    .object({
      test: z.union([z.array(z.string()), z.string()]).optional(),
      interval: z.string().optional(),
      timeout: z.string().optional(),
      retries: z.number().int().nonnegative().optional(),
    })
    .default({}),
  route: z.string().optional(),
  response: z.string().optional(),
  infrastructure: ServiceInfrastructureSchema.default({}),
}).passthrough();

const ServicesSchema = z
  .object({
    dir: z.string().default("./apps"),
  })
  .catchall(InlineServiceSchema);

const DependenciesSchema = z
  .union([
    z.record(z.string().min(1), z.string().min(1)),
    z.array(z.record(z.string().min(1), z.string().min(1))),
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
    registry: z.string().default(""),
    tag: z.string().optional(),
    version: z.string().optional(),
  }),
]);

const ProjectOsSchema = z.object({
  base: BaseImageSchema.default("kevin-mind/nopo:local"),
  dependencies: DependenciesSchema,
  user: z
    .object({
      uid: z.number().int().nonnegative().default(1001),
      gid: z.number().int().nonnegative().default(1001),
      home: z.string().default("/home/nopo"),
    })
    .default({}),
});

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  os: ProjectOsSchema.default({
    base: "kevin-mind/nopo:local",
  }),
  services: ServicesSchema.default({
    dir: "./apps",
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export interface ServiceInfrastructure {
  cpu: string;
  memory: string;
  port: number;
  minInstances: number;
  maxInstances: number;
  hasDatabase: boolean;
  runMigrations: boolean;
  staticPath: string;
}

export interface NormalizedHealthcheck {
  test: string[];
  interval?: string;
  timeout?: string;
  retries?: number;
}

interface ServiceOriginBase<T extends "inline" | "directory"> {
  type: T;
  path: string;
}

export interface NormalizedDirectoryService {
  id: string;
  name: string;
  description: string;
  route?: string;
  infrastructure: ServiceInfrastructure;
  origin: ServiceOriginBase<"directory">;
  paths: {
    root: string;
    config: string;
    dockerfile: string;
    context: string;
  };
}

export interface NormalizedInlineService {
  id: string;
  name: string;
  description: string;
  route?: string;
  infrastructure: ServiceInfrastructure;
  origin: ServiceOriginBase<"inline">;
  inline: {
    start?: string;
    command?: string;
    docker?: string;
    ports: string[];
    volumes: string[];
    environment: Record<string, string>;
    healthcheck?: NormalizedHealthcheck;
    response?: string;
  };
}

export type NormalizedService =
  | NormalizedDirectoryService
  | NormalizedInlineService;

export interface NormalizedOsConfig {
  base: {
    registry: string;
    image: string;
    version: string;
    fullTag: string;
  };
  dependencies: Record<string, string>;
  user: {
    uid: number;
    gid: number;
    home: string;
  };
}

export interface NormalizedServicesConfig {
  dir: string;
  entries: Record<string, NormalizedService>;
  targets: string[];
  order: string[];
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
  const services = normalizeServices(parsed.services, resolvedRoot, resolvedConfigPath);

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
    return contents ? parseYaml(contents) ?? {} : {};
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
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
  if (typeof base === "string") {
    const tag = base.includes(":") ? base : `${base}:local`;
    const parsed = new DockerTag(tag).parsed;
    return {
      registry: parsed.registry,
      image: parsed.image,
      version: parsed.version,
      fullTag: new DockerTag(parsed).fullTag,
    };
  }

  const version = base.tag || base.version || "local";
  const parsed = new DockerTag({
    registry: base.registry || "",
    image: base.image,
    version,
  }).parsed;

  return {
    registry: parsed.registry,
    image: parsed.image,
    version: parsed.version,
    fullTag: new DockerTag(parsed).fullTag,
  };
}

function normalizeServices(
  servicesConfig: ProjectConfig["services"],
  rootDir: string,
  rootConfigPath: string,
): NormalizedServicesConfig {
  const entries: Record<string, NormalizedService> = {};
  const dir = path.resolve(rootDir, servicesConfig.dir);

  if (!fs.existsSync(dir)) {
    throw new Error(
      `Configured services.dir "${servicesConfig.dir}" does not exist (resolved to ${dir}).`,
    );
  }

  const directories = discoverDirectoryServices(dir, entries);
  const inline = normalizeInlineServices(
    servicesConfig,
    entries,
    rootConfigPath,
  );

  const targets = Object.keys(directories).sort();
  const inlineNames = Object.keys(inline).sort();

  return {
    dir,
    entries,
    targets,
    order: [...targets, ...inlineNames],
  };
}

function discoverDirectoryServices(
  servicesDir: string,
  entries: Record<string, NormalizedService>,
): Record<string, NormalizedDirectoryService> {
  const discovered: Record<string, NormalizedDirectoryService> = {};
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

    const normalized: NormalizedDirectoryService = {
      id: serviceId,
      name: parsed.name ?? serviceId,
      description: parsed.description ?? "",
      route: parsed.route,
      infrastructure,
      origin: {
        type: "directory",
        path: serviceConfigPath,
      },
      paths: {
        root: serviceRoot,
        config: serviceConfigPath,
        dockerfile: path.resolve(serviceRoot, parsed.dockerfile),
        context: path.resolve(serviceRoot, parsed.context),
      },
    };

    ensureServiceIsUnique(serviceId, entries, normalized);
    entries[serviceId] = normalized;
    discovered[serviceId] = normalized;
  }

  return discovered;
}

function normalizeInlineServices(
  servicesConfig: ProjectConfig["services"],
  entries: Record<string, NormalizedService>,
  configPath: string,
): Record<string, NormalizedInlineService> {
  const inline: Record<string, NormalizedInlineService> = {};

  for (const [key, value] of Object.entries(servicesConfig)) {
    if (key === "dir") continue;
    const parsed = InlineServiceSchema.parse(value);
    const infrastructure = normalizeInfrastructure(parsed.infrastructure);
    const healthcheck = normalizeHealthcheck(parsed.healthcheck);

    const normalized: NormalizedInlineService = {
      id: key,
      name: key,
      description: parsed.description ?? "",
      route: parsed.route,
      infrastructure,
      origin: {
        type: "inline",
        path: configPath,
      },
      inline: {
        start: parsed.start,
        command: parsed.command,
        docker: parsed.docker,
        ports: parsed.ports,
        volumes: parsed.volumes,
        environment: parsed.environment,
        healthcheck,
        response: parsed.response,
      },
    };

    ensureServiceIsUnique(key, entries, normalized);
    entries[key] = normalized;
    inline[key] = normalized;
  }

  return inline;
}

function ensureServiceIsUnique(
  id: string,
  entries: Record<string, NormalizedService>,
  next: NormalizedService,
): void {
  if (!entries[id]) return;
  const existing = entries[id];
  throw new Error(
    `Duplicate service "${id}" defined in ${next.origin.path} and ${existing.origin.path}. Service IDs must be unique.`,
  );
}

function normalizeInfrastructure(
  infra: z.infer<typeof ServiceInfrastructureSchema>,
): ServiceInfrastructure {
  return {
    cpu: infra.cpu,
    memory: infra.memory,
    port: infra.port,
    minInstances: infra.min_instances,
    maxInstances: infra.max_instances,
    hasDatabase: infra.has_database,
    runMigrations: infra.run_migrations,
    staticPath: infra.static_path,
  };
}

function normalizeHealthcheck(
  healthcheck: z.infer<
    (typeof InlineServiceSchema)["shape"]["healthcheck"]
  >,
): NormalizedHealthcheck | undefined {
  if (!healthcheck || Object.keys(healthcheck).length === 0) return undefined;
  const rawTest = healthcheck.test;
  const test = rawTest
    ? Array.isArray(rawTest)
      ? rawTest
      : [rawTest]
    : [];

  return {
    test,
    interval: healthcheck.interval,
    timeout: healthcheck.timeout,
    retries: healthcheck.retries,
  };
}
