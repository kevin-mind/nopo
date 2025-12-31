import type {
  NormalizedProjectConfig,
  NormalizedService,
  CommandDependencies,
} from "../config/index.ts";

/**
 * Represents a command to execute on a specific service.
 */
export interface CommandDependencySpec {
  service: string;
  command: string;
}

/**
 * Represents an execution plan with stages that can be run in parallel.
 * Each stage contains commands that are independent of each other.
 */
export interface ExecutionPlan {
  stages: CommandDependencySpec[][];
}

/**
 * Validates that all top-level target services have the specified command defined.
 * Dependencies of those services do NOT need to have the command defined.
 *
 * @param project - The normalized project configuration
 * @param commandName - The command to validate (e.g., "lint", "build")
 * @param targets - The top-level target service IDs
 * @throws Error if any top-level target is missing the command
 */
export function validateCommandTargets(
  project: NormalizedProjectConfig,
  commandName: string,
  targets: string[],
): void {
  for (const target of targets) {
    const service = project.services.entries[target];
    if (!service) {
      throw new Error(
        `Unknown service '${target}'. Available services: ${project.services.targets.join(", ")}`,
      );
    }

    if (!service.commands[commandName]) {
      throw new Error(
        `Service '${target}' does not define command '${commandName}'. ` +
          `Available commands: ${Object.keys(service.commands).join(", ") || "none"}`,
      );
    }
  }
}

/**
 * Resolves the dependencies for a specific command on a service.
 * Returns a flat list of CommandDependencySpec objects representing
 * all dependencies that need to run before this command.
 *
 * @param project - The normalized project configuration
 * @param commandName - The command to resolve dependencies for
 * @param serviceId - The service ID to resolve dependencies for
 * @returns Array of dependencies with their command specifications
 */
export function resolveCommandDependencies(
  project: NormalizedProjectConfig,
  commandName: string,
  serviceId: string,
): CommandDependencySpec[] {
  const service = project.services.entries[serviceId];
  if (!service) {
    return [];
  }

  const command = service.commands[commandName];
  const visited = new Set<string>();
  const result: CommandDependencySpec[] = [];

  // Determine which dependencies to use
  const commandDeps = command?.dependencies;

  // Empty object means explicitly no dependencies (override service-level)
  if (
    commandDeps !== undefined &&
    typeof commandDeps === "object" &&
    !Array.isArray(commandDeps) &&
    Object.keys(commandDeps).length === 0
  ) {
    return [];
  }

  // Get the effective dependencies
  const deps = getEffectiveDependencies(service, commandName);

  // Resolve each dependency recursively
  for (const dep of deps) {
    collectDependencies(
      project,
      dep.service,
      dep.command,
      visited,
      result,
      new Set([serviceId]),
    );
  }

  return result;
}

/**
 * Get effective dependencies for a service command.
 * Command-specific dependencies override service-level dependencies.
 */
function getEffectiveDependencies(
  service: NormalizedService,
  commandName: string,
): CommandDependencySpec[] {
  const command = service.commands[commandName];
  const commandDeps = command?.dependencies;

  // If command has explicit dependencies, use those
  if (commandDeps !== undefined) {
    return normalizeDependencies(commandDeps, commandName);
  }

  // Otherwise, use service-level dependencies with the same command
  return service.dependencies.map((dep) => ({
    service: dep,
    command: commandName,
  }));
}

/**
 * Normalize various dependency formats to a flat list of specs.
 */
function normalizeDependencies(
  deps: CommandDependencies,
  defaultCommand: string,
): CommandDependencySpec[] {
  if (!deps) {
    return [];
  }

  // Array format: ["backend", "worker"] -> same command on each
  if (Array.isArray(deps)) {
    return deps.map((service) => ({
      service,
      command: defaultCommand,
    }));
  }

  // Object format: { backend: ["build", "clean"] }
  const result: CommandDependencySpec[] = [];
  for (const [service, commands] of Object.entries(deps)) {
    for (const cmd of commands) {
      result.push({ service, command: cmd });
    }
  }
  return result;
}

/**
 * Recursively collect all dependencies for a service/command.
 */
function collectDependencies(
  project: NormalizedProjectConfig,
  serviceId: string,
  commandName: string,
  visited: Set<string>,
  result: CommandDependencySpec[],
  path: Set<string>,
): void {
  const key = `${serviceId}:${commandName}`;

  // Skip if already visited
  if (visited.has(key)) {
    return;
  }

  const service = project.services.entries[serviceId];
  if (!service) {
    return;
  }

  // Skip if service doesn't have this command
  const command = service.commands[commandName];
  if (!command) {
    return;
  }

  // Mark as visited
  visited.add(key);

  // Get this service's dependencies and recurse first
  const deps = getEffectiveDependencies(service, commandName);
  for (const dep of deps) {
    // Check for circular dependencies
    if (path.has(dep.service)) {
      continue; // Skip circular for dependency collection (checked in build plan)
    }

    const newPath = new Set(path);
    newPath.add(serviceId);

    collectDependencies(
      project,
      dep.service,
      dep.command,
      visited,
      result,
      newPath,
    );
  }

  // Add this dependency to result
  result.push({ service: serviceId, command: commandName });
}

/**
 * Builds an execution plan that groups independent commands into stages
 * that can be run in parallel.
 *
 * @param project - The normalized project configuration
 * @param commandName - The command to build the plan for
 * @param targets - The top-level target service IDs
 * @returns An execution plan with stages for parallel execution
 * @throws Error if circular dependencies are detected
 */
export function buildExecutionPlan(
  project: NormalizedProjectConfig,
  commandName: string,
  targets: string[],
): ExecutionPlan {
  // Collect all tasks that need to run
  const allTasks = new Map<string, CommandDependencySpec>();

  for (const target of targets) {
    // First, add all dependencies for this target
    const deps = resolveCommandDependencies(project, commandName, target);
    for (const dep of deps) {
      const key = `${dep.service}:${dep.command}`;
      if (!allTasks.has(key)) {
        allTasks.set(key, dep);
      }
    }

    // Then add the target itself
    const key = `${target}:${commandName}`;
    if (!allTasks.has(key)) {
      allTasks.set(key, { service: target, command: commandName });
    }
  }

  // Build dependency graph for topological sort
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  // Initialize graph nodes
  for (const [key] of allTasks) {
    graph.set(key, new Set());
    inDegree.set(key, 0);
  }

  // Build edges based on dependencies
  for (const [key, task] of allTasks) {
    const service = project.services.entries[task.service];
    if (!service) continue;

    const deps = getEffectiveDependencies(service, task.command);

    for (const dep of deps) {
      const depKey = `${dep.service}:${dep.command}`;

      // Only add edge if the dependency is in our task set
      if (allTasks.has(depKey)) {
        const edges = graph.get(depKey) || new Set();
        edges.add(key);
        graph.set(depKey, edges);

        const degree = inDegree.get(key) || 0;
        inDegree.set(key, degree + 1);
      }
    }
  }

  // Detect circular dependencies using Kahn's algorithm
  const stages: CommandDependencySpec[][] = [];
  const remaining = new Map(inDegree);

  while (remaining.size > 0) {
    // Find all tasks with no remaining dependencies
    const stage: CommandDependencySpec[] = [];

    for (const [key, degree] of remaining) {
      if (degree === 0) {
        const task = allTasks.get(key);
        if (task) {
          stage.push(task);
        }
      }
    }

    // If no tasks can be executed, we have a circular dependency
    if (stage.length === 0) {
      const remainingTasks = Array.from(remaining.keys()).join(", ");
      throw new Error(
        `Circular dependency detected. Cannot resolve: ${remainingTasks}`,
      );
    }

    // Add stage and update degrees
    stages.push(stage);

    for (const task of stage) {
      const key = `${task.service}:${task.command}`;
      remaining.delete(key);

      const edges = graph.get(key);
      if (edges) {
        for (const dependentKey of edges) {
          const degree = remaining.get(dependentKey);
          if (degree !== undefined) {
            remaining.set(dependentKey, degree - 1);
          }
        }
      }
    }
  }

  return { stages };
}
