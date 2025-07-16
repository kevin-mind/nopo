export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

FIRST_WORD = $(firstword $(MAKECMDGOALS))
SECOND_WORD = $(word 2,$(MAKECMDGOALS))

export SERVICE_NAME ?= $(SECOND_WORD)

.PHONY: fly
fly:
	npx zx ./fly/scripts/$(SECOND_WORD).js

.PHONY: nopo
nopo:
	cd ./docker/scripts && \
	yes | pnpm install --ignore-workspace && \
	pnpm build && \
	pnpm link --global

.PHONY: shell
shell:
	if [ "$(FIRST_WORD)" = "$@" ]; then \
		docker compose run --rm $(or $(SERVICE_NAME),base) bash; \
	fi

.PHONY: down
down:
	docker compose down --rmi local

.PHONY: *
%:
	@if [ "$(FIRST_WORD)" = "$@" ]; then pnpm nopo $(MAKECMDGOALS); fi
