export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

DOCKER_SERVICE ?=

.PHONY: shell
shell:
ifeq ($(DOCKER_SERVICE),)
	docker compose run --rm base bash
else
	docker compose exec $(DOCKER_SERVICE) bash
endif

.PHONY: down
down:
	docker compose down --rmi local

.PHONY: up
up:
	pnpm run scripts up

.PHONY: scripts
%:
ifneq ($(DOCKER_SERVICE),)
	pnpm run --filter @more/$(DOCKER_SERVICE) $(MAKECMDGOALS)
else
	pnpm run $(MAKECMDGOALS)
endif
