#!/bin/bash

build_info=$(cat /build-info.json)

repo=$(echo "${build_info}" | jq -r '.repo')
branch=$(echo "${build_info}" | jq -r '.branch')
commit=$(echo "${build_info}" | jq -r '.commit')

echo "Repo: ${repo}"
echo "Branch: ${branch}"
echo "Commit: ${commit}"

git clone "${repo}" .
git checkout "${branch}"
git reset --hard "${commit}"

pnpm install:lock
