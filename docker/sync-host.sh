#!/bin/bash

yes | pnpm install

target=$(jq -r '.target' "/build-info.json")

if [[ "${target}" == "production" ]]; then
  pnpm build
fi
