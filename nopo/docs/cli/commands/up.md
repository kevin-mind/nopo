# up

Start the services with automatic dependency management.

## Overview

The `up` command is the primary command for starting the development environment. It automatically handles environment setup, image building or pulling, dependency synchronization, and service startup. This is typically the only command you need to run to get the full development environment up and running.

## Usage

```bash
nopo up
```

## Arguments

This command does not accept any arguments.

## Options

This command does not accept any options.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKER_BUILD` | Force local build instead of pull | `false` |
| `DOCKER_VERSION` | Image version | `local` |
| `DOCKER_TAG` | Complete Docker image tag | From `.env` |
| `DOCKER_TARGET` | Build target (`development` or `production`) | Based on version |
| `DOCKER_PORT` | Port for the main service | Random free port |

## Dependencies

The `up` command automatically runs dependencies based on conditions:

| Command | Condition |
|---------|-----------|
| [`env`](./env.md) | Always (sets up environment variables) |
| [`build`](./build.md) | When `DOCKER_VERSION=local` or `DOCKER_BUILD=true` |
| [`pull`](./pull.md) | When using a remote image version |

### Dependency Logic

The command determines whether to build or pull based on:

```typescript
function isBuild(runner): boolean {
  const forceBuild = !!config.processEnv.DOCKER_BUILD;
  const localVersion = environment.env.DOCKER_VERSION === "local";
  return forceBuild || localVersion;
}
```

## Examples

### Start with local build (default)

```bash
nopo up
```

### Force local build

```bash
DOCKER_BUILD=true nopo up
```

### Start with pre-built image

```bash
DOCKER_VERSION=v1.0.0 nopo up
```

### Start production mode locally

```bash
DOCKER_TARGET=production nopo up
```

## How It Works

1. **Environment Setup**: Runs the `env` command to configure environment variables
2. **Image Preparation**: Either builds locally or pulls from registry
3. **Dependency Sync**: Syncs Node.js and Python dependencies in parallel
4. **Container Cleanup**: Brings down any existing containers that need rebuilding
5. **Image Pull**: Pulls any additional images (databases, etc.)
6. **Service Startup**: Starts all services in detached mode
7. **Health Wait**: Waits for all services to be healthy
8. **Success Message**: Displays the URL to access the application

### Parallel Operations

The following operations run in parallel for faster startup:

- **UV Sync**: Python dependencies (`uv sync --locked --active`)
- **pnpm Sync**: Node.js dependencies (`pnpm install --frozen-lockfile`)
- **Down Services**: Stops containers using the old image
- **Pull Images**: Pulls supporting images (databases, etc.)

### Offline-First Strategy

Both dependency managers try offline mode first:

1. **UV (Python)**: Tries `--offline` flag first, falls back to online
2. **pnpm (Node)**: Tries `--offline` flag first, falls back to online

This makes subsequent starts faster when caches are warm.

### Production Mode

When `DOCKER_TARGET=production`:

```bash
# Builds all packages before starting
pnpm -r build
```

This ensures all packages are compiled for production.

## Output

The command outputs progress for each step:

```plaintext
======================================
env: Set up environment variables
======================================
Updated: /path/to/project/.env
...

======================================
build: Build base image and service images
======================================
Building targets: all
...

[sync_uv] Resolved 45 packages
[sync_pnpm] Packages are up to date
[down] Stopping containers...
[up] Starting services...

🚀 Services are up! Visit: http://localhost:8080
```

## Service Configuration

Services are discovered from:

- **Compose Files**: `apps/*/docker-compose.yml`
- **Root Compose**: `docker-compose.yml` (aggregates via `include`)

### Container Options

Services start with these Docker Compose options:

| Option | Description |
|--------|-------------|
| `--remove-orphans` | Remove containers not in compose file |
| `-d` | Detached mode (run in background) |
| `--no-build` | Don't rebuild images (already built) |
| `--wait` | Wait for services to be healthy |

## Error Handling

### Failed Health Checks

If services fail to start or become healthy:

```plaintext
[log:backend] Error: Connection refused...
Error: Failed to start services
```

The command automatically retrieves logs from all services to help debug.

### Missing Docker Tag

```plaintext
Error: DOCKER_TAG is required but was empty
```

Solution: Run `nopo env` first or set `DOCKER_TAG`.

### Dependency Sync Failures

If UV or pnpm fail to sync:

```plaintext
Offline uv sync failed, falling back to online sync...
```

The command automatically retries with online mode.

## Use Cases

### Daily Development

```bash
# Start your day
nopo up

# Work on code (changes hot-reload)
# ...

# End of day
nopo down
```

### Clean Start

```bash
# Remove everything and start fresh
nopo down
nopo up
```

### Using Production Images

```bash
# Pull and run production images locally
DOCKER_VERSION=v1.0.0 nopo up
```

### CI/CD Pipeline

```bash
# Build and test
nopo up
nopo run test
nopo down
```

## Port Access

After successful startup, access the application at:

```plaintext
http://localhost:<DOCKER_PORT>
```

The port is displayed in the success message and stored in `.env`.

## See Also

- [`down`](./down.md) - Stop the services
- [`build`](./build.md) - Build images manually
- [`pull`](./pull.md) - Pull images manually
- [`status`](./status.md) - Check service status
- [`env`](./env.md) - Set up environment variables

