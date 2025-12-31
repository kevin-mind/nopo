export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true
export PATH := $(PWD)/node_modules/.bin:$(PATH)

FIRST_WORD = $(firstword $(MAKECMDGOALS))
SECOND_WORD = $(word 2,$(MAKECMDGOALS))

export SERVICE_NAME ?= $(SECOND_WORD)

.PHONY: default
default:
	pnpm install
	nopo

.PHONY: fly
fly:
	node ./fly/scripts/$(SECOND_WORD).js

.PHONY: shell
shell:
	docker compose run --rm $(or $(SERVICE_NAME),base) bash

.PHONY: *
%:
	@if [ "$(FIRST_WORD)" = "$@" ]; then nopo $(MAKECMDGOALS); fi
