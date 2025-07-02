# Scripts

Date: 2025-07-02

Status: accepted

## Context

In order to hack on this project you need to be able to run various scripts, in various contexts, in various environments.
It gets pretty complicated pretty quickly.

Our project is designed to run seamlessly in a local docker container environment (on any hardware), in a devcontainer environment,
in a CI environment and in various production environments. This means we need to be able to install dependencies, run services,
and execute commands and everything should "just work".

To further complicate things, some commands should run from a specific container as different containers defined their own
environment variables and other settings. If we run the django test command from the web container, and the environment variable
your test depends on is set to a different valuem, or not at all, then your test could fail in weird and unpredicatble ways.

We also don't want a cumbersome setup where you have to run super long winded commands in order to achieve a clear and simple objective.

ex: pseudo code this is not actually real but it could look this ugly.

```bash
pnpm exec --filter @more/backend uv run python manage.py test --with-args foo=bar
```

you reallly just want to run `make test` and be done with it.

## Decision

We already have a nice setup for executing commands via make without having a huge makefile. The default make target forwards
the arguemnts to `pnpm run` essentially converting `make test` into `pnpm run test`. Our root `package.json` maps scripts
to run on the root project and within any workspace package that defines the script in its own `package.json`.
So instead of needing to run a bunch of scripts with specific commands and ensuring they run in the right directory,
just running the script by name will automatically run it in any relevant directories.

ex:

```bash
make check
```

Runs `check:lint` `check:types` and any other `check:*` script defined in any package. Cool right?

Some scripts need to run in a specific container. We have a `shell` command in the makefile that connects to a specific
docker compose service by name (via `SERVICE_NAME`). Additionally all docker compose services define this environment variable
to know what workspace package to target when running. We can reuse this behavior when running scripts to make the default even more intuitive.

When running `make test` the makefile will check if `SERVICE_NAME` is defined and if so will filter for that specific workspace package.

So if you shell into the `backend` service container and run `make test` it will actually run `pnpm run --filter @more/backend test`.

This is pretty powerful as it essentially makes each container focus on it's specific commands by default, while still allowing
a user to run commands on a wider set by simply overriding the `SERVICE_NAME` environment variable to "".

## Consequences

Users need to be intentional about what commands they are running ,and where.

Additionally we need to expand our CI to run tests on each application container to esure all tests/checks are run.
