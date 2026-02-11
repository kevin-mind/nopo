import type {
  NormalizedProjectConfig,
  NormalizedService,
  NormalizedCommand,
  NormalizedSubCommand,
  CommandDependencies,
  CommandContext,
} from "../config/index.ts";
import { extractDependencyNames } from "../config/index.ts";

/**
 * Represents a command to execute on a specific service.
 */
interface CommandDependencySpec {
  service: string;
  command: string;
}

/**
 * Represents a resolved command with its executable and execution context.
 */
export interface ResolvedCommand {
  service: string;
  command: string;
  executable: string;
  env?: Record<string, string>;
  dir?: string; // "root", absolute path, or relative to service
  context?: CommandContext; // "host" (default) or "container"
}

/**
 * Represents an execution plan with stages that can be run in parallel.
 * Each stage contains commands that are independent of each other.
 */
interface ExecutionPlan {
  stages: ResolvedCommand[][];
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

    // Get the root command name (before any colons for subcommands)
    const rootCommand = commandName.split(":")[0]!;

    if (!service.commands[rootCommand]) {
      throw new Error(
        `Service '${target}' does not define command '${commandName}'. ` +
          `Available commands: ${Object.keys(service.commands).join(", ") || "none"}`,
      );
    }
  }
}

/**
 * Resolve a command to its executable(s).
 * If the command has subcommands, returns all subcommands flattened.
 * Subcommands are returned with their full path (e.g., "lint:ts").
 *
 * @param project - The normalized project configuration
 * @param commandName - The command to resolve (can include subcommand path like "lint:ts")
 * @param serviceId - The service ID
 * @returns Array of resolved commands with executables
 */
export function resolveCommand(
  project: NormalizedProjectConfig,
  commandName: string,
  serviceId: string,
): ResolvedCommand[] {
  const service = project.services.entries[serviceId];
  if (!service) {
    throw new Error(`Unknown service '${serviceId}'`);
  }

  const parts = commandName.split(":");
  const rootCommand = parts[0]!;
  const subPath = parts.slice(1);

  const command = service.commands[rootCommand];
  if (!command) {
    throw new Error(
      `Command '${commandName}' not found in service '${serviceId}'. ` +
        `Available commands: ${Object.keys(service.commands).join(", ") || "none"}`,
    );
  }

  // If there's a subpath, navigate to the specific subcommand
  if (subPath.length > 0) {
    return resolveSubCommandPath(serviceId, rootCommand, command, subPath);
  }

  // If the command has subcommands, return all of them
  if (command.commands) {
    return flattenSubCommands(
      serviceId,
      rootCommand,
      command.commands,
      command.env,
      command.dir,
      command.context,
    );
  }

  // Simple command with executable
  if (command.command) {
    return [
      {
        service: serviceId,
        command: commandName,
        executable: command.command,
        env: command.env,
        dir: command.dir,
        context: command.context,
      },
    ];
  }

  throw new Error(
    `Command '${commandName}' in service '${serviceId}' has no executable`,
  );
}

/**
 * Navigate to a specific subcommand path and resolve it.
 */
function resolveSubCommandPath(
  serviceId: string,
  basePath: string,
  command: NormalizedCommand,
  subPath: string[],
): ResolvedCommand[] {
  let current: NormalizedCommand | NormalizedSubCommand = command;
  let currentPath = basePath;
  // Inherit env/dir/context from parent commands
  let inheritedEnv: Record<string, string> | undefined = command.env;
  let inheritedDir: string | undefined = command.dir;
  let inheritedContext: CommandContext | undefined = command.context;

  for (const part of subPath) {
    currentPath = `${currentPath}:${part}`;

    if (!current.commands || !current.commands[part]) {
      throw new Error(
        `Command '${currentPath}' not found in service '${serviceId}'`,
      );
    }

    current = current.commands[part];
    // Child env/dir/context overrides parent
    if (current.env) inheritedEnv = { ...inheritedEnv, ...current.env };
    if (current.dir) inheritedDir = current.dir;
    if (current.context) inheritedContext = current.context;
  }

  // If we landed on a command with subcommands, flatten them
  if (current.commands) {
    return flattenSubCommands(
      serviceId,
      currentPath,
      current.commands,
      inheritedEnv,
      inheritedDir,
      inheritedContext,
    );
  }

  // Single command
  if (current.command) {
    return [
      {
        service: serviceId,
        command: currentPath,
        executable: current.command,
        env: current.env ? { ...inheritedEnv, ...current.env } : inheritedEnv,
        dir: current.dir || inheritedDir,
        context: current.context || inheritedContext,
      },
    ];
  }

  throw new Error(
    `Command '${currentPath}' in service '${serviceId}' has no executable`,
  );
}

/**
 * Flatten all subcommands into resolved commands.
 */
function flattenSubCommands(
  serviceId: string,
  basePath: string,
  subCommands: Record<string, NormalizedSubCommand>,
  parentEnv?: Record<string, string>,
  parentDir?: string,
  parentContext?: CommandContext,
): ResolvedCommand[] {
  const result: ResolvedCommand[] = [];

  for (const [name, subCmd] of Object.entries(subCommands)) {
    const cmdPath = `${basePath}:${name}`;
    // Merge env from parent, child overrides
    const mergedEnv = subCmd.env ? { ...parentEnv, ...subCmd.env } : parentEnv;
    // Child dir/context overrides parent
    const effectiveDir = subCmd.dir || parentDir;
    const effectiveContext = subCmd.context || parentContext;

    if (subCmd.commands) {
      // Recurse into nested subcommands
      result.push(
        ...flattenSubCommands(
          serviceId,
          cmdPath,
          subCmd.commands,
          mergedEnv,
          effectiveDir,
          effectiveContext,
        ),
      );
    } else if (subCmd.command) {
      result.push({
        service: serviceId,
        command: cmdPath,
        executable: subCmd.command,
        env: mergedEnv,
        dir: effectiveDir,
        context: effectiveContext,
      });
    }
  }

  return result;
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
 * @throws Error if a dependency does not have the required command
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

  // Get the root command (before subcommand path)
  const rootCommand = commandName.split(":")[0]!;
  const command = service.commands[rootCommand];
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
  const deps = getEffectiveDependencies(service, rootCommand);

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
 * Uses only explicit command.depends_on - no fallback to service-level dependencies.
 * Returns empty array if command.depends_on is not defined.
 */
function getEffectiveDependencies(
  service: NormalizedService,
  commandName: string,
): CommandDependencySpec[] {
  const command = service.commands[commandName];
  const commandDeps = command?.dependencies;

  // Only use explicit command dependencies
  if (commandDeps !== undefined) {
    return normalizeDependencies(commandDeps, commandName);
  }

  // No implicit dependencies - return empty array
  return [];
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
 * @throws Error if a dependency service does not have the required command
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
    throw new Error(`Unknown service '${serviceId}' referenced as dependency`);
  }

  // Error if service doesn't have this command (changed from skip to error)
  const command = service.commands[commandName];
  if (!command) {
    throw new Error(
      `Service '${serviceId}' does not define command '${commandName}'. ` +
        `Dependencies must have the required command defined.`,
    );
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
  // Collect all tasks that need to run, including subcommands
  const allTasks = new Map<string, ResolvedCommand>();
  const taskDependencies = new Map<string, Set<string>>();

  for (const target of targets) {
    // First, add all dependencies for this target
    const deps = resolveCommandDependencies(project, commandName, target);
    for (const dep of deps) {
      addTasksForCommand(
        project,
        dep.service,
        dep.command,
        allTasks,
        taskDependencies,
      );
    }

    // Then add the target itself
    addTasksForCommand(
      project,
      target,
      commandName,
      allTasks,
      taskDependencies,
    );
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
  for (const [key] of allTasks) {
    const deps = taskDependencies.get(key) || new Set();

    for (const depKey of deps) {
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
  const stages: ResolvedCommand[][] = [];
  const remaining = new Map(inDegree);

  while (remaining.size > 0) {
    // Find all tasks with no remaining dependencies
    const stage: ResolvedCommand[] = [];

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

/**
 * Add tasks for a command, handling subcommands.
 */
function addTasksForCommand(
  project: NormalizedProjectConfig,
  serviceId: string,
  commandName: string,
  allTasks: Map<string, ResolvedCommand>,
  taskDependencies: Map<string, Set<string>>,
): void {
  const resolved = resolveCommand(project, commandName, serviceId);
  const rootCommand = commandName.split(":")[0]!;

  // Get service-level dependencies for this command
  const service = project.services.entries[serviceId];
  const serviceDeps = service
    ? getEffectiveDependencies(service, rootCommand)
    : [];

  for (const task of resolved) {
    const key = `${task.service}:${task.command}`;
    if (!allTasks.has(key)) {
      allTasks.set(key, task);

      // Subcommands are siblings - they don't depend on each other
      // but they do depend on the service-level dependencies
      const deps = new Set<string>();
      for (const dep of serviceDeps) {
        // Add dependency on all resolved commands from the dependency service
        try {
          const depResolved = resolveCommand(project, dep.command, dep.service);
          for (const depTask of depResolved) {
            deps.add(`${depTask.service}:${depTask.command}`);
          }
        } catch {
          // If dependency doesn't have the command, it was already validated
        }
      }
      taskDependencies.set(key, deps);
    }
  }
}
