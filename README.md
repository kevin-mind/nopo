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

The build pipeline now produces a reusable base image (`nopo:<tag>`) plus optional
service layers that inherit from it.

- `nopo build` runs the buildx bake definition in `nopo/docker/docker-bake.hcl`
  and publishes the base image.
- `nopo build --service backend --service web` builds the Dockerfiles that live
  under `apps/<service>/Dockerfile`. The CLI verifies that each image contains the
  base `/build-info.json`, records the resulting tag as `<SERVICE>_IMAGE` inside
  `.env`, and respects the existing `DOCKER_PUSH` flag.
- `nopo build --service backend --dockerFile ./apps/backend/Custom.Dockerfile`
  allows pointing at an arbitrary Dockerfile (exactly one `--service` is required
  when using this flag).

All Compose services are defined alongside their apps (see
`apps/*/docker-compose.yml`) and are aggregated via the Compose `include`
directive (requires Docker Compose v2.20+).

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
