# Nopo Scripts

A TypeScript-based CLI tool for managing Docker-based development environments with automatic dependency resolution and environment configuration.

## Features

- **TypeScript-first**: Fully typed codebase with strict type checking
- **Vite-based build**: Single executable output for fast startup
- **Dependency resolution**: Automatic script dependency management
- **Environment management**: Automated Docker tag parsing and environment setup
- **Docker integration**: Built-in support for Docker Buildx, Compose, and registry operations

## Available Commands

- `env` - Set up environment variables
- `build` - Build Docker images with Buildx
- `pull` - Pull Docker images from registry
- `up` - Start services with automatic dependency management
- `status` - Check service status and system information
- `run` - Execute pnpm scripts in services

## Development

To run this CLI locally, use pnpm and link the package globally.

1) Run `pnpm install --ignore-workspace` to install dependencies locally.

2) Run the development build `pnpm build` to continuously build the code.

3) Run `pnpm link --global` to the link the package to the global bin

4) Run the package anywhenre `pnpm nopo <commands>`

This will make the `nopo` CLI and package available in your other local project as if it were installed from a registry, but using your local version.

### Prerequisites

- Node.js 18+
- pnpm or npm
- Docker and Docker Compose

### Scripts

```bash
# Build the TypeScript code
npm run build

# Development build with watch mode
npm run dev

# Type checking
npm run check:types

# Linting
npm run check:lint

# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Clean build artifacts
npm run clean
```

### Project Structure

```bash
docker/scripts/
├── src/
│   ├── index.ts          # Main CLI entry point
│   ├── lib.ts             # Core classes (Script, Runner, Logger)
│   ├── parse-env.ts       # Environment parsing and validation
│   ├── docker-tag.ts      # Docker tag parsing utilities
│   ├── git-info.ts        # Git information utilities
│   └── scripts/           # Individual script implementations
│       ├── env.ts
│       ├── build.ts
│       ├── pull.ts
│       ├── up.ts
│       ├── status.ts
│       └── index.ts       # Default run script
├── tests/                 # Test files
├── dist/                  # Built output
├── bin.js                 # CLI wrapper
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Installation as Linked Dependency

To install this package as a linked dependency in the root repository so you can execute commands directly via terminal:

### Method 1: Using pnpm link (Recommended)

1. **In the scripts directory**, create a global link:

   ```bash
   cd docker/scripts
   pnpm link --global
   ```

2. **In the root project directory**, link the package:

   ```bash
   cd /path/to/your/project
   pnpm link --global nopo
   ```

3. **Verify installation**:

   ```bash
   nopo --help
   nopo env --help
   nopo status
   ```

### Method 2: Using npm link

1. **In the scripts directory**:

   ```bash
   cd docker/scripts
   npm link
   ```

2. **In the root project directory**:

   ```bash
   cd /path/to/your/project
   npm link nopo
   ```

### Method 3: Direct Installation

1. **Build the package**:

   ```bash
   cd docker/scripts
   npm run build
   ```

2. **Install globally**:

   ```bash
   npm install -g .
   ```

3. **Or install locally in your project**:

   ```bash
   cd /path/to/your/project
   npm install file:./docker/scripts
   ```

### Method 4: Using pnpm workspace (if part of monorepo)

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

## Usage Examples

### Basic Commands

```bash
# Set up environment variables
nopo env

# Build Docker images
nopo build

# Start all services
nopo up

# Check service status
nopo status

# Run a script in a specific service
nopo run test --service backend

# Run a script in a specific workspace
nopo run build --workspace web
```

### Environment Variables

The tool automatically manages these environment variables:

- `DOCKER_PORT` - Docker port
- `DOCKER_TAG` - Complete Docker tag
- `DOCKER_REGISTRY` - Docker registry URL
- `DOCKER_IMAGE` - Image name
- `DOCKER_VERSION` - Image version/tag
- `DOCKER_DIGEST` - Image digest (optional)
- `DOCKER_TARGET` - Build target (development/production)
- `NODE_ENV` - Node environment
- `GIT_REPO` - Git repository URL
- `GIT_BRANCH` - Current git branch
- `GIT_COMMIT` - Current git commit hash

### Advanced Usage

#### Custom Docker Builder

```bash
DOCKER_BUILDER=my-builder nopo build
```

#### Force Build (skip pull)

```bash
DOCKER_BUILD=true nopo up
```

#### Push Images After Build

```bash
DOCKER_PUSH=true nopo build
```

#### Custom Environment File

```bash
ENV_FILE=.env.staging nopo env
```

## Architecture

### Core Classes

- **Script**: Base class for all commands with dependency resolution
- **Runner**: Orchestrates script execution and dependency management
- **Environment**: Handles environment variable parsing and validation
- **Logger**: Configurable logging with color support
- **DockerTag**: Docker tag parsing and manipulation utilities

### Dependency System

Scripts can declare dependencies that are automatically resolved:

```typescript
export default class MyScript extends Script {
  static dependencies = [
    {
      class: EnvScript,
      enabled: true
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

## Contributing

1. Make changes to TypeScript source files in `src/`
2. Add tests in `tests/` directory
3. Run `npm run check:types` to verify types
4. Run `npm test` to ensure tests pass
5. Run `npm run build` to verify build works
6. Update documentation if needed

## Troubleshooting

### Build Errors

- Ensure all dependencies are installed: `npm install`
- Check TypeScript errors: `npm run check:types`
- Clear build cache: `npm run clean && npm run build`

### CLI Not Found After Installation

- Verify the package is properly linked: `npm ls -g nopo`
- Check your PATH includes npm/pnpm global bin directory
- Try rebuilding: `npm run build`

### Permission Errors

- On Unix systems, ensure the binary is executable: `chmod +x ./bin.js`
- For global installation, you may need sudo: `sudo npm install -g .`
