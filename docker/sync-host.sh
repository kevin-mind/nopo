#!/bin/bash

set -xue

rm -rf node_modules .venv
pnpm install --frozen-lockfile --offline
uv sync --locked --offline
pnpm -r build
