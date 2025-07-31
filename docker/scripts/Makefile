.PHONY: check
check:
	@pnpm pnpm "/^check:.*/"

.PHONY: fix
fix:
	@pnpm pnpm "/^fix:.*/"

.PHONY: test
test:
	@pnpm test

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
