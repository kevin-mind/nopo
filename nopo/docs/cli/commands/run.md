# run

Run a pnpm script in a specified service and package.

## Overview

The `run` command executes pnpm scripts across the monorepo, either locally or within Docker containers. It provides a unified interface for running scripts in specific workspaces or services with automatic dependency resolution.

## Usage

```bash
nopo run <script> [targets...] [options]
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `script` | The pnpm script name (or pattern) to run | Yes |
| `targets` | Optional list of targets to run the script in. If omitted, runs locally | No |

### Available Targets

Targets are discovered from `apps/*/Dockerfile` (e.g., `backend`, `web`).

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--filter <expr>` / `-F <expr>` | Filter targets by expression (can be used multiple times) | None |
| `--since <ref>` | Git reference for `changed` filter | default branch |

### Filtering

You can filter which services to run scripts on using expressions:

```bash
# Run tests on services with changes since main branch
nopo run test --filter changed

# Run lint on buildable services only
nopo run lint --filter buildable

# Run scripts on services with database
nopo run migrate --filter infrastructure.hasDatabase=true
```

See [`list`](./list.md) for full filter expression documentation.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENV_FILE` | Path to the environment file | `.env` |
| `DOCKER_BUILD` | Force local build | `false` |
| `DOCKER_VERSION` | Image version | From `.env` |

## Dependencies

The `run` command automatically runs dependencies based on conditions:

| Command | Condition |
|---------|-----------|
| [`env`](./env.md) | When service is down and needs build/pull |
| [`build`](./build.md) | When service is down and local build is needed |
| [`pull`](./pull.md) | When service is down and pull is needed |

### Dependency Logic

- If targets are provided and the target is not running:
  - If `DOCKER_VERSION=local` or `DOCKER_BUILD=true`: builds the image
  - Otherwise: pulls the image from the registry

## Examples

### Run a script across all workspaces

```bash
nopo run test
```

This runs `pnpm run /^test.*/` across all workspaces.

### Run a script in a Docker target

```bash
nopo run test backend
```

This runs the test script inside the `backend` Docker container.

### Run a script in multiple targets

```bash
nopo run test backend web
```

This runs the test script in both `backend` and `web` containers sequentially.

### Run lint in all workspaces

```bash
nopo run lint
```

### Run dev server in backend

```bash
nopo run dev backend
```

## How It Works

1. **Parse Arguments**: Extracts script name, service, and workspace from arguments
2. **Check Service State**: Determines if the target service container is running
3. **Resolve Dependencies**: If service is down, builds or pulls images as needed
4. **Execute Script**: Runs the pnpm script either locally or in a Docker container

### Script Resolution

The script name is converted to a regex pattern:

| Input | Resolved Pattern |
|-------|------------------|
| `test` | `/^test.*/` |
| `build` | `/^build.*/` |
| `lint` | `/^lint.*/` |

This allows matching scripts like `test`, `test:unit`, `test:e2e`, etc.

### Script Execution

When no targets are provided, the script runs locally:

```bash
pnpm run --fail-if-no-match /<script>.*/
```

### Docker Execution

When targets are provided, the script runs inside Docker containers:

```bash
docker compose run --rm --remove-orphans <target> pnpm run ...
```

Each target is run sequentially. Containers are automatically removed after execution (`--rm`).

## Output

The command streams output from the pnpm script:

```plaintext
[backend] > @more/backend@0.0.0 test
[backend] > vitest run
[backend]
[backend]  ✓ src/tests/index.test.ts (3 tests) 45ms
[backend]
[backend]  Test Files  1 passed (1)
[backend]       Tests  3 passed (3)
```

## Use Cases

### Run Tests in CI

```bash
# Run all tests
nopo run test

# Run specific target tests
nopo run test backend
```

### Development Workflow

```bash
# Start services
nopo up

# Run specific script in container
nopo run migrate backend

# Run type checking
nopo run check:types
```

### Build Packages

```bash
# Build all packages
nopo run build

# Build only changed services
nopo run build --filter changed
```

## Error Handling

### Script Not Found

If no matching script is found:

```plaintext
ERR_PNPM_NO_SCRIPT_MATCH  No scripts matching /^foo.*/ in any workspace
```

Solution: Check the script name exists in package.json files.

### Target Not Found

If the specified target doesn't exist:

```plaintext
Error: Unknown target 'invalid'. Available targets: backend, web
```

Solution: Check available targets with `nopo status` or check `apps/*/Dockerfile`.

### Missing Script Argument

If no script name is provided:

```plaintext
Error: Usage: run [script] [targets...] [--filter <expr>]
```

## See Also

- [`up`](./up.md) - Start services before running scripts
- [`status`](./status.md) - Check which services are running
- [`env`](./env.md) - Set up environment variables

