#!/bin/bash

yes | pnpm install

rm -rf "${UV_PROJECT_ENVIRONMENT:-.venv}"
uv sync

target=$(jq -r '.target' "/build-info.json")

if [[ "${target}" == "production" ]]; then
  pnpm build
fi
