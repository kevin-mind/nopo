.PHONY: install
install:
	@pnpm install --ignore-workspace --loglevel="error"

.PHONY: build
build:
	@pnpm build --logLevel="error" > /dev/null

.PHONY: init
init: install build
	@echo "nopo initialized"
