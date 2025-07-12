export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

FIRST_WORD = $(firstword $(MAKECMDGOALS))
SECOND_WORD = $(word 2,$(MAKECMDGOALS))

export SERVICE_NAME ?= $(SECOND_WORD)

.PHONY: uv-check
uv-check:
	@./uv-run.sh

.PHONY: uv-sync
uv-sync:
	@./uv-run.sh sync --frozen

.PHONY: uv-run
uv-run:
	@./uv-run.sh run $(ARGS)

.PHONY: uv-shell
uv-shell:
	@./uv-run.sh run bash

.PHONY: py
py:
	@./uv-run.sh run python $(ARGS)

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
	@if [ "$(FIRST_WORD)" = "$@" ]; then \
		yes | npx --package=./docker/scripts nopo $(MAKECMDGOALS); \
	fi
