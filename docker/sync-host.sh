#!/bin/bash
set -xueo

yes | pnpm install

target=$(cat /build-info.json | jq -r '.target')

if [[ "${target}" == "production" ]]; then
  pnpm build
fi
