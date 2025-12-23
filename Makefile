export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

FIRST_WORD = $(firstword $(MAKECMDGOALS))
SECOND_WORD = $(word 2,$(MAKECMDGOALS))

export SERVICE_NAME ?= $(SECOND_WORD)

.PHONY: default
default:
	pnpm install
	npx -y tsx ./nopo/scripts/bin.ts

.PHONY: fly
fly:
	node ./fly/scripts/$(SECOND_WORD).js

.PHONY: shell
shell:
	docker compose run --rm $(or $(SERVICE_NAME),base) bash

.PHONY: *
%:
	@if [ "$(FIRST_WORD)" = "$@" ]; then npx -y tsx ./nopo/scripts/bin.ts $(MAKECMDGOALS); fi
