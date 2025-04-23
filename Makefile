export DOCKER_BUILD_METADATA_FILE ?= build-metadata.json

DOCKER_SERVICE ?= base
REST_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))

DOCKER = docker
DOCKER_COMPOSE = $(DOCKER) compose

.PHONY: lockfile
lockfile:
	npm_config_offline=false pnpm install --lockfile-only --no-frozen-lockfile

.PHONY: install
install:
	pnpm install $(REST_ARGS)

.PHONY: clean
clean:
	pnpm clean $(REST_ARGS)

.PHONY: check
check:
	pnpm check $(REST_ARGS)

.PHONY: fix
fix:
	pnpm fix $(REST_ARGS)

.PHONY: build
build:
	$(DOCKER) buildx bake \
		--load \
		--progress=plain \
		--metadata-file $(DOCKER_BUILD_METADATA_FILE) \
		$(REST_ARGS)

.PHONY: exec
exec:
	$(DOCKER_COMPOSE) exec $(DOCKER_SERVICE) $(REST_ARGS)

.PHONY: shell
shell:
	$(DOCKER_COMPOSE) run --rm $(DOCKER_SERVICE) bash

.PHONY: start
start:
	$(DOCKER_COMPOSE) up -d --remove-orphans $(REST_ARGS)
	$(DOCKER_COMPOSE) rm -f

.PHONY: up
up: build start

.PHONY: down
down:
	$(DOCKER_COMPOSE) down --rmi local $(REST_ARGS)
