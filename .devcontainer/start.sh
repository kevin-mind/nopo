#!/bin/bash

set -xue

if [ -n "${CODESPACES}" ]; then
    echo "Running in Codespaces environment"
    schema="https"
    host="${CODESPACE_NAME}-${DOCKER_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
    export SITE_URL="${schema}://${host}"
else
  echo "Running in local environment"
fi

pnpm install

make up