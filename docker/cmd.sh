#!/bin/bash

service="${SERVICE_NAME:-}"
command="${SERVICE_COMMAND:-}"

if [[ "${service}" == "" ]]; then
  echo "SERVICE_NAME is not set"
  exit 1
fi

if [[ "${command}" == "" ]]; then
  echo "SERVICE_COMMAND is not set"
  exit 1
fi

set -xue

if [[ "${service}" == "nopo" ]]; then
  pnpm "${command}"
else
  pnpm --filter "@more/${service}" "${command}"
fi
