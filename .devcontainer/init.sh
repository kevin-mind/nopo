#!/bin/bash

pnpm install

make env DOCKER_TARGET=devcontainer DOCKER_TAG=local NODE_ENV=development

mv .env ./.devcontainer/.env
