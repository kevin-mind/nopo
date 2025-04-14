ARGS := $(MAKECMDGOALS)

SUB = $(firstword $(ARGS))
CMD = $(wordlist 2, $(words $(ARGS)), $(ARGS))

.PHONY: help
help:
	@echo "Usage: make <subcommand> [command...]"
	@echo "Example: make docker lint"
	@echo "Available subcommands:"
	@echo "  $(patsubst Makefile-%,%,$(notdir $(wildcard Makefile-*)))"
	@exit 1
.DEFAULT_GOAL := help

.PHONY: turbo
turbo:
	npm exec turbo -- run $(CMD)

.PHONY: docker
docker:
	docker compose exec web $(CMD)

%:
ifneq ($(and $(SUB),$(CMD)),)
	@echo "==================================="
	@echo "sub: $(SUB)"
	@echo "cmd: $(CMD)"
	@echo "==================================="
else
	make help
endif

