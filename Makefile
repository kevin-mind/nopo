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
	docker compose run --rm web npm install
	docker compose up -d --remove-orphans

.PHONY: down
down:
	docker compose down --rmi local
