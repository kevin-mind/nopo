#!/bin/bash

set -xue

echo "Initializing devcontainer..."

npm install --global corepack@latest
corepack enable pnpm
corepack prepare pnpm --activate

make env ENV_FILE=./.devcontainer/.env DOCKER_TARGET=user
