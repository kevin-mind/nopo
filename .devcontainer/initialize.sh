#!/bin/bash

make env \
  DOCKER_TAG="kevin-mind/nopo:devcontainer-local" \
  DOCKER_TARGET="user" \
  DOCKER_PORT="80" \
  ENV_FILE="./.devcontainer/.env"
