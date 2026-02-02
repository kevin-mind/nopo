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
		if git show-ref --verify --quiet "refs/heads/claude/issue/$(issue)"; then \
			echo "Branch claude/issue/$(issue) exists locally, using it..."; \
			git worktree add "../nopo-issue-$(issue)" "claude/issue/$(issue)"; \
		elif git show-ref --verify --quiet "refs/remotes/origin/claude/issue/$(issue)"; then \
			echo "Branch claude/issue/$(issue) exists remotely, checking out and tracking..."; \
			git worktree add "../nopo-issue-$(issue)" "claude/issue/$(issue)"; \
		else \
			echo "Branch claude/issue/$(issue) does not exist, creating from origin/main..."; \
			git worktree add "../nopo-issue-$(issue)" -b "claude/issue/$(issue)" origin/main; \
		fi; \
	fi
	@echo "Setting up worktree..."
	@cd "../nopo-issue-$(issue)" && \
		. "$(HOME)/.nvm/nvm.sh" && nvm use 22 && \
		pnpm install && \
		make -C nopo/scripts init
	@echo ""
	@echo "Worktree ready at ../nopo-issue-$(issue)"
	@echo "Run: cd ../nopo-issue-$(issue) && claude"

.PHONY: smoketest
smoketest:
	pnpm exec playwright test --reporter=list

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

