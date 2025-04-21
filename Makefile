export DOCKER_BUILD_METADATA_FILE ?= build-metadata.json

DOCKER_SERVICE ?= base
REST_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))

DOCKER = docker
DOCKER_COMPOSE = $(DOCKER) compose
DOCKER_COMPOSE_RUN = $(DOCKER_COMPOSE) run --rm $(DOCKER_SERVICE)

.PHONY: clean
clean:
	$(DOCKER_COMPOSE_RUN) pnpm clean $(REST_ARGS)

.PHONY: check
check:
	$(DOCKER_COMPOSE_RUN) pnpm check $(REST_ARGS)

.PHONY: fix
fix:
	$(DOCKER_COMPOSE_RUN) pnpm fix $(REST_ARGS)

.PHONY: build
build:
	$(DOCKER) buildx bake \
		--load \
		--progress=plain \
		--metadata-file $(DOCKER_BUILD_METADATA_FILE) \
		$(REST_ARGS)

.PHONY: exec
exec:
	$(DOCKER_COMPOSE_RUN) $(REST_ARGS)

.PHONY: shell
shell:
	$(DOCKER_COMPOSE_RUN) bash

.PHONY: up
up:
	$(DOCKER_COMPOSE) up -d --remove-orphans $(REST_ARGS)
	$(DOCKER_COMPOSE) rm -f

.PHONY: down
down:
	$(DOCKER_COMPOSE) down --rmi local $(REST_ARGS)
