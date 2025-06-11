export FORCE_COLOR = 1
export NPM_FORCE_COLOR = 1
export DOCKER_BUILDKIT = 1
export DOCKER_BUILDKIT_PROGRESS = auto
export COMPOSE_BAKE=true

.PHONY: shell
shell:
	docker compose exec --user nodeuser $(ARGS) web /bin/bash

.PHONY: down
down:
	docker compose down --rmi local

define run_script
	pnpm run scripts $(1)
endef

env:
	$(call run_script,env)

image:
	$(call run_script,image)

up:
	$(call run_script,up)

status:
	$(call run_script,status)

%:
	pnpm run $(MAKECMDGOALS)
