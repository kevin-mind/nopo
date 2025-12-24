# pull

Pull the base image from the registry.

## Overview

The `pull` command downloads the Docker base image from a remote registry. This is useful when you want to use pre-built images instead of building locally, typically for faster development setup or when using production images.

## Usage

```bash
nopo pull
```

## Arguments

This command does not accept any arguments.

## Options

This command does not accept any options.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKER_TAG` | The image tag to pull | From `.env` |
| `DOCKER_REGISTRY` | Docker registry URL | From `.env` |
| `DOCKER_IMAGE` | Base image name | From `.env` |
| `DOCKER_VERSION` | Image version | From `.env` |

## Dependencies

The `pull` command automatically runs the following commands first:

| Command | Condition |
|---------|-----------|
| [`env`](./env.md) | Always (ensures environment is configured) |

## Examples

### Pull the default image

```bash
nopo pull
```

### Pull a specific version

```bash
DOCKER_VERSION=v1.0.0 nopo pull
```

### Pull from a specific registry

```bash
DOCKER_REGISTRY=ghcr.io/kevin-mind DOCKER_VERSION=latest nopo pull
```

### Pull a complete tag

```bash
DOCKER_TAG=ghcr.io/kevin-mind/nopo:v1.0.0 nopo pull
```

## How It Works

1. **Environment Setup**: Runs the `env` command to ensure environment variables are configured
2. **Tag Resolution**: Reads `DOCKER_TAG` from the environment
3. **Image Pull**: Executes `docker compose pull` with the `--policy always` flag to force refresh

### Docker Compose Integration

The command uses the base compose file at `nopo/docker/docker-compose.base.yml` to pull the image. This ensures the pulled image matches the expected configuration.

### Pull Policy

The `--policy always` flag ensures that:

- The image is always pulled from the registry, even if it exists locally
- You get the latest image for mutable tags like `latest`
- Cached images don't prevent updates

## Output

The command outputs the image being pulled:

```plaintext
Pulling image: ghcr.io/kevin-mind/nopo:v1.0.0
```

Followed by Docker's pull progress:

```plaintext
[+] Pulling 5/5
 ✔ base Pulled
```

## Use Cases

### Fast Development Setup

Pull pre-built images instead of building locally:

```bash
DOCKER_VERSION=latest nopo pull
nopo up
```

### CI/CD Pipeline

Use pulled images in CI to avoid rebuilding:

```bash
DOCKER_TAG=$CI_IMAGE_TAG nopo pull
nopo up
```

### Testing Production Images

Pull and test production images locally:

```bash
DOCKER_REGISTRY=ghcr.io/kevin-mind DOCKER_VERSION=v1.0.0 nopo pull
nopo up
```

## Comparison with Build

| Aspect | `nopo pull` | `nopo build` |
|--------|-------------|--------------|
| Source | Remote registry | Local Dockerfile |
| Speed | Fast (download only) | Slower (compile/build) |
| Requirements | Registry access | Docker Buildx |
| Use Case | Use existing images | Create new images |
| Local Changes | Not included | Included |

## Error Handling

### Image Not Found

If the image doesn't exist in the registry:

```plaintext
Error: manifest for kevin-mind/nopo:v999 not found
```

Solution: Check that the version exists in the registry.

### Authentication Required

If the registry requires authentication:

```plaintext
Error: unauthorized: authentication required
```

Solution: Log in to the registry:

```bash
docker login ghcr.io
```

### Network Issues

If there are network connectivity issues:

```plaintext
Error: error pulling image configuration: Get ... dial tcp: lookup ...
```

Solution: Check network connectivity and retry.

## See Also

- [`build`](./build.md) - Build images locally
- [`up`](./up.md) - Start services (pulls or builds automatically)
- [`env`](./env.md) - Set up environment variables

