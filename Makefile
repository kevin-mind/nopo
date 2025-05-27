export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

DOCKER_SERVICE ?= base

DOCKER = docker
DOCKER_COMPOSE = $(DOCKER) compose

################################################################################
# Commands that don't need special handling
################################################################################

.PHONY: clean
clean:
	make run DOCKER_RUN=clean

.PHONY: check
check:
	make run DOCKER_RUN=check

.PHONY: fix
fix:
	make run DOCKER_RUN=fix

.PHONY: test
test:
	pnpm test

.PHONY: env
env:
	pnpm run script env

.PHONY: image
image:
	pnpm run script image

.PHONY: run
run:
	pnpm run script run

.PHONY: up
up:
	pnpm run script up

################################################################################
# Commands that still need special handling
################################################################################

.PHONY: exec
exec:
	$(DOCKER_COMPOSE) exec $(DOCKER_SERVICE)

.PHONY: shell
shell: image
	$(DOCKER_COMPOSE) run --rm --entrypoint /bin/bash --user nodeuser $(DOCKER_SERVICE)

.PHONY: down
down:
	$(DOCKER_COMPOSE) down --rmi local
