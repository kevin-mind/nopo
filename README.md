# nopo

Because everything is better with more nopo\*.

\* mo(no)re(po) - more nopo

## Scripts

Run the project using the companion CLI (nopo).

Run a command via

```bash
make <command>
```

If the command is not defined in the Makefile, it will be passed to the nopo CLI using tsx
to run against the most recent code.

### Build

The build pipeline produces a reusable base image (`nopo:<tag>`) plus service
layers that inherit from it. All builds use Docker Buildx Bake for parallel
execution.

- `nopo build` builds everything: base image + all discovered services (in parallel)
- `nopo build base` builds only the base image
- `nopo build backend` builds the backend service (base is built automatically as a dependency)
- `nopo build backend web` builds both services in parallel (plus base)

Service image tags are recorded as `<SERVICE>_IMAGE` in `.env`. The `DOCKER_PUSH`
flag controls whether images are pushed to the registry.

All Compose services are defined alongside their apps (see
`apps/*/docker-compose.yml`) and are aggregated via the Compose `include`
directive (requires Docker Compose v2.20+).

## Configuration (`nopo.yml`)

The CLI now loads all service metadata from YAML instead of inferring it from
the filesystem. Two kinds of files are involved:

- `./nopo.yml` – project-level defaults (`os`, dependencies, inline services)
- `./apps/<service>/nopo.yml` – service-specific infrastructure settings

Example root config:

```yaml
name: Nopo Project
os:
  base:
    image: kevin-mind/nopo
    tag: local
services:
  dir: ./apps
  shaddow:
    description: Inline hello-world service
    static_path: ""
    command: |
      printf 'Hello from shaddow\n'
```

Every real service directory (backend, web, etc.) now ships with its own
`nopo.yml` describing CPU/memory, scaling limits, `static_path`, and database
requirements. The CLI consumes these files to decide which services exist, so
removing the file will also remove the service from `nopo build|up|run`.

Use the new command (routed through the Makefile) to validate configuration changes locally:

```bash
make config validate -- --json --services-only
```

`make config validate -- ...` can also print a machine-readable summary that is reused
by CI/CD scripts. A sample inline service (`shaddow`) is provided out of the
box and is routed locally at `http://localhost:<port>/shaddow`.

Infrastructure tests that exercise the extendable image contract live in
`nopo/docker/tests/extendable.sh`. Run the script after touching the base image to
ensure derived images can install new npm packages while `/opt/nopo-core`
remains read-only and the embedded `/build-info.json` matches the current base
tag.

### Env

Set the environment variables for the project.

### Index

Catch all that passes the command to pnpm across all workspaces.

### Pull

Pull the latest docker image for the project.

### Status

Show the status of the project.

### Up

Start the project.

## Todo

- [ ] add storybook
- [X] make the app a workspace (encapsulate the source and configs)
- [X] create database service (postgres)
- [X] create ui package
- [X] add vitest
- [X] add github actions for CI
- [X] setup deployment on fly.io
- [X] add codespaces support
- [X] add version endpoint and UI badge
- [X] add health check in deployment to verify deployed
- [X] add smoketest via playwright
- [X] add post deploy push of latest image and release document
- [ ] add PR deployment
- [ ] add deployment link to PR
- [ ] add release link to PR and parent issue

## Tests

- test the config
- test the build
- test development hot mode works
- test production serves optimized assets
