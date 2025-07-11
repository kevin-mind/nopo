# nopo

Because everything is better with more nopo\*.

\* mo(no)re(po) - more nopo

## Scripts

Run the project using the companion CLI (nopo).

Use the make file to build the CLI locally and link it to global pnpm.

```bash
make nopo
```

Now you can run commands using nopo on any shell.

```bash
nopo status
```

### Build

Build the docker image for the project. Nopo projects
use a single docker image for all services.

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
