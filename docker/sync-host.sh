#!/bin/bash

set -xue

uv sync --locked --active --offline
yes | pnpm install --frozen-lockfile --offline

build_info=$(cat /build-info.json)

target=$(echo "${build_info}" | jq -r '.target')

if [[ "${target}" == "production" ]]; then
  pnpm -r build
fi
