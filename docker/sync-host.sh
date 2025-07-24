#!/bin/bash

set -xue

rm -rf node_modules .venv
pnpm "/^install:lock.*/"
uv sync --offline --frozen --no-install-workspace
pnpm "/^build.*/"
