export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

DOCKER_SERVICE ?= base

.PHONY: shell
shell:
	docker compose exec $(ARGS) $(DOCKER_SERVICE) bash

.PHONY: down
down:
	docker compose down --rmi local

.PHONY: up
up:
	pnpm run scripts up

.PHONY: scripts
%:
	pnpm run $(MAKECMDGOALS)
