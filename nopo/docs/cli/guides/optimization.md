# Performance

Optimize nopo workflows with caching, parallel execution, and resource management.

## Quick Wins

```bash
# 1. Enable offline sync (automatic)
nopo up  # First run online, subsequent runs offline

# 2. Use host execution for fast checks
nopo lint web           # vs nopo run lint web (faster)

# 3. Build only what you need
nopo build backend       # vs nopo build (all)

# 4. Use parallel builds
nopo build backend web   # Services build in parallel
```

## Offline-First Sync

### How It Works

1. **Try offline sync first** (fast)
2. **Fall back to online** if cache empty (slower)
3. **Cache dependencies** for next run

### Benefits

- **5-10x faster** on subsequent runs
- **Network independent** once cached
- **Consistent dependencies** across environments

### Cache Management

```bash
# Warm up cache (one-time)
nopo build
nopo up

# Clear if needed
docker volume rm nopo_base_cache

# Rebuild fresh cache
nopo build --no-cache
```

## Parallel Execution

### Dependency Stages

```
Stage 1: [shared:build]           # No dependencies
Stage 2: [backend:build, api:build]  # Parallel (both depend on shared)
Stage 3: [web:build]              # After backend
```

### Optimize for Parallelism

```yaml
# Good: Minimal dependencies
name: web
dependencies: []

name: api
dependencies: []

# Avoid: Deep dependency chains
name: frontend
dependencies: [backend]    # backend depends on shared
name: backend
dependencies: [shared]     # frontend waits for backend -> shared
```

## Build Caching

### Cache Types

| Environment | Cache Strategy       | When to Use         |
| ----------- | -------------------- | ------------------- |
| Development | Local Docker cache   | Local development   |
| CI          | GitHub Actions cache | CI pipelines        |
| Custom      | Registry cache       | Shared environments |

### Cache Configuration

```bash
# GitHub Actions (automatic in CI)
nopo build

# Custom registry cache
DOCKER_BUILDKIT_CACHE=type=registry,ref=mycache \
DOCKER_BUILDKIT_CACHE_TO=type=registry,ref=mycache,mode=max \
nopo build

# Disable cache
nopo build --no-cache
```

### Dockerfile Optimization

```dockerfile
# Good: Layer optimization
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN pnpm install     # Cached if package files unchanged
COPY . .
RUN pnpm build       # Cached if source unchanged

# Bad: Inefficient layering
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN pnpm install && pnpm build  # Runs on any source change
```

## Resource Management

### Target Selection

```bash
# Build only needed services
nopo build backend

# Filter services
nopo list --filter buildable
nopo list --filter has_database
```

### Service Limits

```yaml
infrastructure:
  cpu: "1" # Appropriate allocation
  memory: "256Mi" # Minimal sufficient
  min_instances: 0 # Scale to zero
  max_instances: 10 # Reasonable max
```

### Container Lifecycle

```bash
# Automatic cleanup (built-in)
nopo up  # Removes orphaned containers

# Manual cleanup if needed
docker compose down --remove-orphans
docker system prune -f
```

## Performance Monitoring

### Timing

```bash
# Measure build performance
time nopo build

# Compare online vs offline sync
time nopo up  # First run (online)
time nopo up  # Second run (offline)
```

### Debug Performance

```bash
# Enable timing debug
DEBUG=timing nopo build

# Cache debugging
DEBUG=cache nopo build

# Service debugging
DEBUG=service:backend nopo up backend
```

### System Resources

```bash
# Check Docker resource usage
docker stats

# Monitor disk usage
docker system df

# Service status
nopo status --json
```

## Best Practices

### Development Workflow

```bash
# 1. Fast iteration
nopo lint web        # Quick host checks
nopo up web          # Start single service

# 2. Incremental testing
nopo run test web     # Container testing
nopo up web           # Restart with changes
```

### CI/CD Optimization

```bash
# Pipeline stages (parallel where possible)
- lint: nopo lint           # Fast, no containers
- test: nopo run test       # Parallel with lint
- build: nopo build         # After lint/test pass
```

### Cache Strategy

1. **Local development**: Use automatic local caching
2. **CI pipelines**: Enable GitHub Actions cache
3. **Production**: Consider registry cache for sharing
4. **Regular cleanup**: Clear old cache periodically

---

**See Also**: [Reference](../reference.md) - Performance-related environment variables
