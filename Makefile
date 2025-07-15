export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

FIRST_WORD = $(firstword $(MAKECMDGOALS))
SECOND_WORD = $(word 2,$(MAKECMDGOALS))

export SERVICE_NAME ?= $(SECOND_WORD)

.PHONY: nopo
nopo:
	cd ./docker/scripts && ./init.sh

.PHONY: shell
shell:
	docker compose run --rm $(or $(SERVICE_NAME),base) bash

.PHONY: *
%:
	@if [ "$(FIRST_WORD)" = "$@" ]; then pnpm nopo $(MAKECMDGOALS); fi
