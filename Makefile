export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

DOCKER_SERVICE ?= base

DOCKER = docker
DOCKER_COMPOSE = $(DOCKER) compose

################################################################################
# Commands that still need special handling
################################################################################

.PHONY: shell
shell: image
	$(DOCKER_COMPOSE) run --rm --entrypoint /bin/bash --user nodeuser $(DOCKER_SERVICE)

.PHONY: down
down:
	$(DOCKER_COMPOSE) down --rmi local

################################################################################
# Default command executes @more/scripts executable scripts
# ex: make status will run ./packages/scripts/index.ts status
# ex: to add multiple arguments use double quotes to prevent make from interpreting them
# $ make "status --help" will pass --help as an argument to the script
# Note: using npx zx directly means we do not depend on pnpm being installed
################################################################################

%:
	pnpx zx --install ./packages/scripts/index.ts $(MAKECMDGOALS)

