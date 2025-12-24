# Nopo CLI

A TypeScript-based CLI tool for managing Docker-based development environments with automatic dependency resolution and environment configuration.

## Overview

The `nopo` CLI is designed to streamline the development workflow for monorepo projects that use Docker containers. It provides a unified interface for building images, managing environments, and running services with intelligent dependency resolution.

### Key Features

- **TypeScript-first**: Fully typed codebase with strict type checking
- **Vite-based build**: Single executable output for fast startup
- **Dependency resolution**: Automatic script dependency management between commands
- **Environment management**: Automated Docker tag parsing and environment setup
- **Docker integration**: Built-in support for Docker Buildx Bake, Compose, and registry operations
- **Target discovery**: Automatically discovers targets with Dockerfiles in `apps/`

## Installation

### Prerequisites

- Node.js 20+
- pnpm (recommended) or npm
- Docker and Docker Compose v2.20+

### Method 1: Using pnpm link (Recommended)

1. Navigate to the scripts directory and create a global link:

   ```bash
   cd nopo/scripts
   pnpm install --ignore-workspace
   pnpm build
   pnpm link --global
   ```

2. In the root project directory, link the package:

   ```bash
   cd /path/to/your/project
   pnpm link --global nopo
   ```

3. Verify the installation:

   ```bash
   nopo --help
   ```

### Method 2: Using npm link

1. In the scripts directory:

   ```bash
   cd nopo/scripts
   npm install
   npm run build
   npm link
   ```

2. In the root project directory:

   ```bash
   cd /path/to/your/project
   npm link nopo
   ```

### Method 3: Direct Installation

1. Build the package:

   ```bash
   cd nopo/scripts
   npm run build
   ```

2. Install globally:

   ```bash
   npm install -g .
   ```

### Method 4: Using pnpm workspace (monorepo)

Add to your root `package.json`:

```json
{
  "dependencies": {
    "nopo": "workspace:*"
  }
}
```

Then run:

```bash
pnpm install
```

## Commands

| Command | Description |
|---------|-------------|
| [`build`](./commands/build.md) | Build base image and target images using Docker Buildx Bake |
| [`down`](./commands/down.md) | Bring down the containers and clean up resources |
| [`env`](./commands/env.md) | Set up environment variables and generate `.env` file |
| [`pull`](./commands/pull.md) | Pull the base image or target images from the registry |
| [`run`](./commands/run.md) | Run a pnpm script in specified targets or locally |
| [`status`](./commands/status.md) | Check the status of the targets and system information |
| [`up`](./commands/up.md) | Start the targets with automatic dependency management |

## Usage

### Basic Usage

```bash
# Show available commands
nopo

# Show help
nopo --help

# Run a specific command
nopo <command> [targets...] [options]
```

### Universal Target Pattern

Most commands support targeting specific services using positional arguments:

```bash
# Build all targets (default)
nopo build

# Build specific targets
nopo build backend web

# Start all targets
nopo up

# Start specific targets
nopo up backend

# Stop all targets
nopo down

# Stop specific targets
nopo down backend web

# Pull base image (default)
nopo pull

# Pull specific target images
nopo pull backend web

# Run script locally
nopo run test

# Run script in specific targets
nopo run test backend web
```

**Target Discovery**: Targets are automatically discovered from `apps/*/Dockerfile`. Each directory in `apps/` that contains a `Dockerfile` is considered a target (e.g., `backend`, `web`).

**Special Cases**:
- The `build` command also supports a special `base` target for the base image
- The `run` command uses the first positional argument as the script name, followed by target names

### Global Environment Variables

These environment variables can be set to customize the behavior of all commands:

| Variable | Description | Default |
|----------|-------------|---------|
| `ENV_FILE` | Path to the environment file | `.env` |
| `DOCKER_BUILDER` | Custom Docker Buildx builder name | `nopo-builder` |

## Architecture

### Core Components

- **Script**: Base class for all commands with dependency resolution
- **Runner**: Orchestrates script execution and dependency management
- **Environment**: Handles environment variable parsing and validation
- **Logger**: Configurable logging with color support
- **DockerTag**: Docker tag parsing and manipulation utilities

### Dependency System

Commands can declare dependencies that are automatically resolved before execution. Dependencies can be conditionally enabled based on the current environment:

```typescript
export default class UpScript extends Script {
  static dependencies = [
    {
      class: EnvScript,
      enabled: true // Always run env first
    },
    {
      class: BuildScript,
      enabled: (runner) => runner.environment.env.DOCKER_VERSION === "local"
    }
  ];
}
```

### Environment Resolution

The tool follows this precedence for configuration:

1. Command line environment variables
2. Process environment variables
3. `.env` file values
4. Computed defaults (git info, free ports, etc.)

## Troubleshooting

### Build Errors

- Ensure all dependencies are installed: `pnpm install`
- Check TypeScript errors: `pnpm run check:types`
- Clear build cache: `pnpm run clean && pnpm run build`

### CLI Not Found After Installation

- Verify the package is properly linked: `pnpm ls -g nopo`
- Check your PATH includes pnpm/npm global bin directory
- Try rebuilding: `pnpm run build`

### Permission Errors

- On Unix systems, ensure the binary is executable: `chmod +x ./bin.js`
- For global installation, you may need sudo: `sudo npm install -g .`

