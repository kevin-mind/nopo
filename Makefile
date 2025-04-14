export TURBO_VERSION = $(shell node \
	-p "require('./package.json').devDependencies.turbo.replace('^', '')" \
)
export NODE_ENV=development
export POSTGRES_DB=mydatabase
export POSTGRES_USER=myuser
export POSTGRES_PASSWORD=mypassword
export WEB_DOCKER_PORT=3000
export WEB_DOCKER_TAG=website/web:latest
export DOCKER_TARGET=development

SHELL_ARGS ?=
SHELL_CMD ?=

ifneq ($(SHELL_CMD),)
	_SHELL_CMD = bash -c "$(SHELL_CMD)"
else
	_SHELL_CMD = bash
endif

ENV_VARS := \
	TURBO_VERSION \
	NODE_ENV \
	POSTGRES_DB \
	POSTGRES_USER \
	POSTGRES_PASSWORD \
	WEB_DOCKER_PORT \
	WEB_DOCKER_TAG \
	DOCKER_TARGET

env:
	@rm -f .env
	@$(foreach v, $(ENV_VARS), \
		echo "$(v)=$(value $(v))" >> .env; \
	)

shell:
	docker compose run --rm $(SHELL_ARGS) web $(_SHELL_CMD)

setup: env
	$(MAKE) shell SHELL_CMD="npm i"

up: setup
	docker compose up --build --remove-orphans --abort-on-container-failure

down:
	docker compose down --remove-orphans --rmi local

build: setup
	docker compose build

lint: setup
	$(MAKE) shell SHELL_CMD="npm run lint"

typecheck: setup
	$(MAKE) shell SHELL_CMD="npm run typecheck"
