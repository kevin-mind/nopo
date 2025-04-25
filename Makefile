export DOCKER_BUILD_METADATA_FILE ?= build-metadata.json

DOCKER_SERVICE ?= base
REST_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))

DOCKER = docker
DOCKER_COMPOSE = $(DOCKER) compose

.PHONY: lockfile_install
lockfile_install:
	pnpm lockfile:install

.PHONY: lockfile_add
lockfile_add:
	pnpm lockfile:add $(REST_ARGS)

.PHONY: clean
clean:
	pnpm clean $(REST_ARGS)

.PHONY: check
check:
	pnpm check $(REST_ARGS)

.PHONY: fix
fix:
	pnpm fix $(REST_ARGS)

.PHONY: test
test:
	pnpm test $(REST_ARGS)

.PHONY: env
env:
	pnpm run script env

.PHONY: build
build: env
	$(DOCKER) buildx bake \
		--load \
		--progress=plain \
		--metadata-file $(DOCKER_BUILD_METADATA_FILE) \
		$(REST_ARGS)

.PHONY: exec
exec:
	$(DOCKER_COMPOSE) exec $(DOCKER_SERVICE) $(REST_ARGS)

.PHONY: shell
shell: env
	$(DOCKER_COMPOSE) run --rm $(DOCKER_SERVICE) bash

.PHONY: start
start:
	$(DOCKER_COMPOSE) up -d --remove-orphans $(REST_ARGS)
	$(DOCKER_COMPOSE) rm -f

.PHONY: up
up: env start

.PHONY: down
down:
	$(DOCKER_COMPOSE) down --rmi local $(REST_ARGS)
