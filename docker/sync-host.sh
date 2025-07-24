#!/bin/bash

set -xue

uv sync --locked --active --offline
pnpm install --frozen-lockfile --offline
pnpm -r build
