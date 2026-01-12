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

.PHONY: shell
shell:
	docker compose run --rm $(or $(SERVICE_NAME),base) bash

.PHONY: *
%:
	@if [ "$(FIRST_WORD)" = "$@" ]; then npx -y tsx ./nopo/scripts/bin.ts $(MAKECMDGOALS); fi

.PHONY: worktree
worktree:
ifndef issue
	$(error Usage: make worktree issue=123)
endif
	@if [ ! -d "../nopo-issue-$(issue)" ]; then \
		git fetch origin 2>/dev/null || true; \
		git worktree add "../nopo-issue-$(issue)" -b "claude/issue/$(issue)" origin/main 2>/dev/null || \
		git worktree add "../nopo-issue-$(issue)" "claude/issue/$(issue)"; \
	fi
	@echo "Installing dependencies in worktree..."
	@cd "../nopo-issue-$(issue)" && pnpm install
	@echo ""
	@echo "Worktree ready at ../nopo-issue-$(issue)"
	@echo "Run: cd ../nopo-issue-$(issue) && claude"

.PHONY: lint-terraform
lint-terraform:
	terraform fmt -recursive infrastructure/terraform
	terraform -chdir=infrastructure/terraform init -backend=false
	terraform -chdir=infrastructure/terraform validate
	@for dir in infrastructure/terraform/modules/*/; do \
		echo "=== Validating $$dir ==="; \
		terraform -chdir="$$dir" init -backend=false; \
		terraform -chdir="$$dir" validate; \
	done
