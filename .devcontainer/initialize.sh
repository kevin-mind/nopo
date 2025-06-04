#!/bin/bash

set -xue

echo "Initializing devcontainer..."

make env ENV_FILE=./.devcontainer/.env DOCKER_TARGET=user
