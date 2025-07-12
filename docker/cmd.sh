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

# Ensure .venv is properly set up for Python services
if [[ "${service}" == "backend" ]]; then
  echo "Checking Python virtual environment..."
  if [ ! -d "/app/.venv" ] || [ ! -f "/app/.venv/pyvenv.cfg" ]; then
    echo "Creating or repairing virtual environment..."
    cd /app
    uv sync --frozen 2>/dev/null || true
  fi
fi

set -xue
pnpm --filter "@more/${service}" "${command}"
