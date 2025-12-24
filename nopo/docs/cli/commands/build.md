# build

Build base image and service images using Docker Buildx Bake.

## Overview

The `build` command creates Docker images for the nopo project using Docker Buildx Bake for parallel and efficient builds. It produces a reusable base image (`nopo:<tag>`) plus service-specific layers that inherit from it.

## Usage

```bash
nopo build [targets...] [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `targets` | Optional list of targets to build. If omitted, builds all targets (base + all services) |

### Available Targets

- `base` - The base image containing shared dependencies
- Service names discovered from `apps/*/Dockerfile` (e.g., `backend`, `web`)

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--no-cache` | Build without using cache | `false` |
| `--output <path>` | Path to write build info JSON | None |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKER_BUILDER` | Custom Docker Buildx builder name | `nopo-builder` |
| `DOCKER_PUSH` | Push images to registry after build | `false` |
| `DOCKER_METADATA_FILE` | Path to write bake metadata | Temp file |
| `DOCKER_TAG` | Base image tag | From `.env` or `kevin-mind/nopo:local` |
| `DOCKER_TARGET` | Build target stage | `development` or `production` |
| `DOCKER_VERSION` | Image version | `local` |
| `DOCKER_REGISTRY` | Docker registry URL | Empty |
| `DOCKER_IMAGE` | Base image name | `kevin-mind/nopo` |
| `GIT_REPO` | Git repository URL | Auto-detected |
| `GIT_BRANCH` | Current git branch | Auto-detected |
| `GIT_COMMIT` | Current git commit hash | Auto-detected |

## Dependencies

The `build` command automatically runs the following commands first:

| Command | Condition |
|---------|-----------|
| [`env`](./env.md) | Always (sets up environment variables) |

## Examples

### Build all images

```bash
nopo build
```

### Build only the base image

```bash
nopo build base
```

### Build a specific service

```bash
nopo build backend
```

### Build multiple services in parallel

```bash
nopo build backend web
```

### Build without cache

```bash
nopo build --no-cache
```

### Build and push to registry

```bash
DOCKER_PUSH=true nopo build
```

### Build with custom builder

```bash
DOCKER_BUILDER=my-builder nopo build
```

### Output build info to file

```bash
nopo build --output build-info.json
```

## How It Works

1. **Environment Setup**: Runs the `env` command to ensure environment variables are configured
2. **Target Resolution**: Determines which targets to build based on arguments or defaults to all
3. **Builder Setup**: Creates or uses an existing Docker Buildx builder (`nopo-builder`)
4. **Bake Definition**: Generates a Docker Bake JSON definition with all targets and their configurations
5. **Parallel Build**: Executes Docker Buildx Bake for parallel image building
6. **Image Loading**: Loads built images into the local Docker daemon
7. **Environment Update**: Records service image tags as `<SERVICE>_IMAGE` in `.env`

### Build Arguments

The following build arguments are passed to the Dockerfile:

| Argument | Description |
|----------|-------------|
| `DOCKER_TARGET` | Build target stage |
| `DOCKER_TAG` | Base image tag |
| `DOCKER_VERSION` | Image version |
| `DOCKER_BUILD` | Same as version (for compatibility) |
| `GIT_REPO` | Git repository URL |
| `GIT_BRANCH` | Current git branch |
| `GIT_COMMIT` | Current git commit hash |
| `SERVICE_NAME` | Name of the service being built |
| `NOPO_APP_UID` | Application user ID (`1001`) |
| `NOPO_APP_GID` | Application group ID (`1001`) |

### Cache Configuration

By default, the build uses GitHub Actions cache:

- Cache from: `type=gha`
- Cache to: `type=gha,mode=max`

### Service Image Tags

Service images are tagged following the pattern:

```plaintext
[registry/]<image>-<service>:<version>
```

For example, if the base tag is `kevin-mind/nopo:local` and the service is `backend`, the service image tag would be `kevin-mind/nopo-backend:local`.

## Output

When using `--output`, the command writes a JSON file with build information:

```json
[
  {
    "name": "base",
    "tag": "kevin-mind/nopo:local",
    "registry": "",
    "image": "kevin-mind/nopo",
    "version": "local",
    "digest": null
  },
  {
    "name": "backend",
    "tag": "kevin-mind/nopo-backend:local",
    "registry": "",
    "image": "kevin-mind/nopo-backend",
    "version": "local",
    "digest": null
  }
]
```

When `DOCKER_PUSH=true`, the `digest` field contains the image digest from the registry.

## See Also

- [`env`](./env.md) - Set up environment variables
- [`up`](./up.md) - Start services (automatically builds if needed)
- [`pull`](./pull.md) - Pull images from registry instead of building

