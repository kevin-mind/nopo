#!/bin/bash
set -xueo

yes | pnpm install

if [[ "${DOCKER_TARGET}" == "production" ]]; then
  pnpm build
fi
