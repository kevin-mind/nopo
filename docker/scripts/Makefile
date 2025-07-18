.PHONY: install
install:
	@pnpm install --ignore-workspace --loglevel="error"

.PHONY: build
build:
	@pnpm build --logLevel="error" > /dev/null

.PHONY: link
link:
	@pnpm link --global --loglevel="error"

.PHONY: init
init: install build link
	@echo "nopo initialized"
