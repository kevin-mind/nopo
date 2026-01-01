# Command Configuration

Commands can be defined in service `nopo.yml` files to specify how the service should execute specific operations. This allows for powerful dependency resolution and parallelization.

## Overview

Instead of relying on `package.json` scripts and naming conventions, nopo allows defining commands directly in `nopo.yml` files with explicit dependency declarations and execution configuration.

When running a command like `nopo check backend`, nopo will:

1. Look for a `check` command in the backend service's `nopo.yml`
2. If found, use nopo's command resolution with dependency graphs
3. If not found, fall back to pnpm's script execution

## Command Definition

Commands are defined in the `commands` section of a service's `nopo.yml`:

```yaml
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint . --debug
  build:
    command: npm run build
  test:
    command: npm run test
```

### Subcommands

Commands can define nested subcommands instead of a direct command. Subcommands run in parallel as siblings:

```yaml
commands:
  check:
    commands:
      types:
        command: tsc --noEmit
      lint:
        command: eslint .
      format:
        command: prettier --check .
```

Running `nopo check web` will execute all three subcommands in parallel.

**Note**: Use hyphens (`-`) instead of colons (`:`) in subcommand names, as colons are used as path separators. For example, use `lint-js` instead of `lint:js`.

You can run a specific subcommand using the path syntax:

```bash
nopo check:types web   # Run only the types subcommand
```

Subcommands support up to 3 levels of nesting:

```yaml
commands:
  check:
    commands:
      lint:
        commands:
          ts:
            command: tsc --noEmit
          js:
            command: eslint .
```

**Important**: Subcommands cannot define their own dependencies. Dependencies are only allowed at the top-level command.

### Command Properties

| Property | Type | Description |
|----------|------|-------------|
| `command` | string | The command to execute (required) |
| `dependencies` | array \| object | Dependencies to run before this command (optional) |

## Service-Level Dependencies

Services can declare dependencies on other services that apply to all commands:

```yaml
name: web
dockerfile: Dockerfile
dependencies:
  - backend
  - shared
commands:
  build:
    command: npm run build
```

When running `nopo build web`, the `build` command will first run on `backend` and `shared` (if they have a `build` command defined).

## Command-Level Dependencies

Commands can override service-level dependencies with their own dependency specification:

### Empty Dependencies (No Dependencies)

Override service-level dependencies to run independently:

```yaml
name: web
dockerfile: Dockerfile
dependencies:
  - backend
commands:
  lint:
    # Running lint ignores service-level dependencies
    dependencies: {}
    command: eslint .
```

### Simple Array Dependencies

Run the same command on multiple services first:

```yaml
name: web
dockerfile: Dockerfile
commands:
  build:
    # Run build on backend and worker first
    dependencies:
      - backend
      - worker
    command: npm run build
```

### Complex Dependencies with Different Commands

Run specific commands on dependencies:

```yaml
name: web
dockerfile: Dockerfile
commands:
  run:
    # Run 'run' on web, then 'build' and 'clean' on backend
    dependencies:
      web:
        - run
      backend:
        - build
        - clean
    command: npm start
```

## Execution Behavior

### Command Resolution

When running `nopo lint web backend`:

1. **Validate** - Check all top-level targets have the `lint` command defined
2. **Resolve Dependencies** - Build dependency graph from service and command dependencies
3. **Build Execution Plan** - Group independent commands into parallel stages
4. **Execute** - Run commands in stage order, parallelizing within each stage

### Dependency Requirements

- **Top-level targets** MUST have the requested command defined
- **Dependencies** do NOT need to have the command (they're skipped if missing)

This allows running `nopo lint web` even if `backend` (a dependency of `web`) doesn't have a `lint` command.

### Parallelization

Commands are automatically parallelized when possible:

```
nopo build web api
```

If both `web` and `api` depend on `shared`:

```
Stage 1: [shared:build]     (run first)
Stage 2: [web:build, api:build]  (run in parallel)
```

### Circular Dependency Detection

Nopo detects circular dependencies and throws an error:

```yaml
# web depends on api
name: web
dependencies:
  - api

# api depends on web - CIRCULAR!
name: api
dependencies:
  - web
```

Running any command on these services will fail with a clear error message.

## Example Usage

### Running Lint Across Services

```bash
nopo lint web backend
```

This will:
1. Validate `web` and `backend` have `lint` defined
2. Resolve dependencies (skip those without `lint`)
3. Execute `lint` in dependency order with parallelization

### Building with Dependencies

Given this configuration:

```yaml
# apps/web/nopo.yml
name: web
dockerfile: Dockerfile
dependencies:
  - backend
commands:
  build:
    command: npm run build

# apps/backend/nopo.yml
name: backend
dockerfile: Dockerfile
dependencies:
  - db
commands:
  build:
    command: npm run build

# apps/db/nopo.yml
name: db
image: postgres:16
commands:
  build:
    command: echo "no build for db"
```

Running `nopo build web` executes:

```
Stage 1: [db:build]
Stage 2: [backend:build]
Stage 3: [web:build]
```

### Running Independent Lints

With `dependencies: {}`:

```yaml
# apps/web/nopo.yml
commands:
  lint:
    dependencies: {}
    command: eslint .

# apps/backend/nopo.yml
commands:
  lint:
    dependencies: {}
    command: ruff check .
```

Running `nopo lint web backend`:

```
Stage 1: [web:lint, backend:lint]  (all in parallel!)
```

## API Reference

### Functions

#### `validateCommandTargets(project, commandName, targets)`

Validates that all top-level targets have the specified command defined.

**Parameters:**
- `project` - NormalizedProjectConfig
- `commandName` - The command to validate (e.g., "lint")
- `targets` - Array of service IDs

**Throws:** Error if any target is missing the command

#### `resolveCommandDependencies(project, commandName, serviceId)`

Resolves all dependencies for a command on a service.

**Parameters:**
- `project` - NormalizedProjectConfig
- `commandName` - The command to resolve
- `serviceId` - The service to resolve dependencies for

**Returns:** Array of `{ service, command }` specs

#### `buildExecutionPlan(project, commandName, targets)`

Builds an execution plan with stages for parallel execution.

**Parameters:**
- `project` - NormalizedProjectConfig
- `commandName` - The command to plan
- `targets` - Array of top-level target service IDs

**Returns:** `ExecutionPlan` with `stages` array

### Types

```typescript
interface CommandDependencySpec {
  service: string;
  command: string;
}

interface ExecutionPlan {
  stages: CommandDependencySpec[][];
}

type CommandDependencies =
  | string[]                      // ["backend", "worker"]
  | Record<string, string[]>      // { backend: ["build", "clean"] }
  | undefined;                    // use service-level deps
```
