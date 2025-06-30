#!/bin/bash

set -xue

echo "Starting packages development environment..."

# First, build all packages once to ensure they're available
echo "Building packages once to ensure availability..."
pnpm run build:workspace --filter "./packages/*"

# Check if any packages have dev scripts before trying to run them
echo "Checking for packages with dev scripts..."
if pnpm run --filter "./packages/*" --dry-run dev 2>/dev/null | grep -q "dev"; then
    echo "Starting package dev watchers..."
    exec pnpm run dev:packages
else
    echo "No packages with dev scripts found, keeping container alive for volume sharing..."
    exec tail -f /dev/null
fi