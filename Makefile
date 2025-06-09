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

%:
	pnpm run $(MAKECMDGOALS)
