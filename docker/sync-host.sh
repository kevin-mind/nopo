#!/bin/bash

set -xue

rm -rf node_modules .venv
pnpm install:lock
pnpm build
