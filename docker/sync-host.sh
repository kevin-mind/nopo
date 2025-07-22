#!/bin/bash

set -xue

rm -rf node_modules .venv
pnpm install --frozen-lockfile
uv sync --locked
pnpm -r build
