.PHONY: clean
clean:
	pnpm clean

.PHONY: check
check:
	pnpm check

.PHONY: fix
fix:
	pnpm fix

.PHONY: status
status:
	@npx tsx scripts/status.ts

.PHONY: build
build:
	docker buildx bake --progress=plain

.PHONY: exec
exec:
	docker compose exec web $(ARGS)

.PHONY: up
up:
	docker compose run --rm web pnpm install
	docker compose up -d --remove-orphans

.PHONY: down
down:
	docker compose down --rmi local
