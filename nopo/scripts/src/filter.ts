import {
  isBuildableService,
  isPackageService,
  isRunnableService,
  type NormalizedService,
} from "./config/index.ts";
import { GitInfo } from "./git-info.ts";
import path from "node:path";

export type FilterExpression = {
  type: "preset" | "exists" | "not_exists" | "equals";
  field?: string;
  value?: string;
};

/**
 * Parse a filter expression string into a FilterExpression object.
 *
 * Supported formats:
 * - "buildable"           -> preset filter (services that can be built)
 * - "changed"             -> preset filter (services with changed files)
 * - "package"/"packages"  -> preset filter (packages - build-only, no runtime)
 * - "service"/"services"  -> preset filter (services - has runtime configuration)
 * - "!fieldname"          -> field does not exist
 * - "fieldname"           -> field exists
 * - "fieldname=value"     -> field equals value
 */
export function parseFilterExpression(expr: string): FilterExpression {
  // Named presets (support both singular and plural forms)
  if (expr === "buildable") {
    return { type: "preset", field: "buildable" };
  }
  if (expr === "changed") {
    return { type: "preset", field: "changed" };
  }
  if (expr === "package" || expr === "packages") {
    return { type: "preset", field: "package" };
  }
  if (expr === "service" || expr === "services") {
    return { type: "preset", field: "service" };
  }

  // Negation: !fieldname
  if (expr.startsWith("!")) {
    return { type: "not_exists", field: expr.slice(1) };
  }

  // Equality: fieldname=value
  if (expr.includes("=")) {
    const [field, ...rest] = expr.split("=");
    return { type: "equals", field, value: rest.join("=") };
  }

  // Field exists
  return { type: "exists", field: expr };
}

/**
 * Context for evaluating filters that may require external data.
 */
export interface FilterContext {
  /** Project root directory */
  projectRoot: string;
  /** Git reference to compare against for 'changed' filter (defaults to default branch) */
  since?: string;
  /** Cached list of changed files (populated lazily) */
  changedFiles?: string[];
}

/**
 * Get the list of changed files, using cache if available.
 */
function getChangedFiles(context: FilterContext): string[] {
  if (context.changedFiles !== undefined) {
    return context.changedFiles;
  }

  const since = context.since ?? GitInfo.getDefaultBranch();
  context.changedFiles = GitInfo.getChangedFiles(since);
  return context.changedFiles;
}

/**
 * Check if a service has any changed files.
 */
function hasChangedFiles(
  service: NormalizedService,
  context: FilterContext,
): boolean {
  const changedFiles = getChangedFiles(context);
  const serviceRoot = path.relative(context.projectRoot, service.paths.root);

  // A service is considered changed if any changed file is within its root directory
  return changedFiles.some(
    (file) => file === serviceRoot || file.startsWith(serviceRoot + "/"),
  );
}

/**
 * Check if a service matches a single filter expression.
 */
export function matchesFilter(
  service: NormalizedService,
  filter: FilterExpression,
  context: FilterContext,
): boolean {
  switch (filter.type) {
    case "preset":
      if (filter.field === "buildable") {
        return isBuildableService(service);
      }
      if (filter.field === "changed") {
        return hasChangedFiles(service, context);
      }
      if (filter.field === "package") {
        return isPackageService(service);
      }
      if (filter.field === "service") {
        return isRunnableService(service);
      }
      return true;

    case "exists":
      return getFieldValue(service, filter.field!) !== undefined;

    case "not_exists":
      return getFieldValue(service, filter.field!) === undefined;

    case "equals": {
      const value = getFieldValue(service, filter.field!);
      if (value === undefined) return false;
      return String(value) === filter.value;
    }

    default:
      return true;
  }
}

/**
 * Get a nested field value from a service using dot notation.
 * E.g., "infrastructure.cpu" -> service.infrastructure.cpu
 */
export function getFieldValue(
  service: NormalizedService,
  field: string,
): unknown {
  // Support dotted paths like "infrastructure.cpu"
  const parts = field.split(".");
  let current: unknown = service;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Apply multiple filters to a list of services (AND logic).
 */
export function applyFilters(
  services: NormalizedService[],
  filters: FilterExpression[],
  context: FilterContext,
): NormalizedService[] {
  if (filters.length === 0) return services;

  return services.filter((service) =>
    filters.every((filter) => matchesFilter(service, filter, context)),
  );
}

/**
 * Apply filters to a list of service names, returning filtered names.
 */
export function applyFiltersToNames(
  serviceNames: string[],
  services: Record<string, NormalizedService>,
  filters: FilterExpression[],
  context: FilterContext,
): string[] {
  if (filters.length === 0) return serviceNames;

  return serviceNames.filter((name) => {
    const service = services[name];
    if (!service) return false;
    return filters.every((filter) => matchesFilter(service, filter, context));
  });
}
