#!/bin/bash

set -xue

APP_NAME="${APP_NAME:-}"

printenv

pnpm --filter "@more/${APP_NAME}..." --parallel run dev
