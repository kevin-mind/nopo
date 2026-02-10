#!/bin/bash
# Script to download and run actionlint
# Works on macOS (arm64/amd64) and Linux (amd64)

set -euo pipefail

VERSION="1.7.7"
INSTALL_DIR="${HOME}/.local/bin"
BINARY="${INSTALL_DIR}/actionlint"

# Create install directory if it doesn't exist
mkdir -p "${INSTALL_DIR}"

# Determine OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "${ARCH}" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: ${ARCH}"; exit 1 ;;
esac

# Map OS names
case "${OS}" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  *) echo "Unsupported OS: ${OS}"; exit 1 ;;
esac

# Download if not exists or version mismatch
if [[ ! -f "${BINARY}" ]] || ! "${BINARY}" --version 2>/dev/null | grep -q "${VERSION}"; then
  echo "Downloading actionlint v${VERSION} for ${OS}/${ARCH}..."

  URL="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_${OS}_${ARCH}.tar.gz"

  TEMP_DIR=$(mktemp -d)
  trap "rm -rf ${TEMP_DIR}" EXIT

  curl -sSL "${URL}" | tar -xz -C "${TEMP_DIR}"
  mv "${TEMP_DIR}/actionlint" "${BINARY}"
  chmod +x "${BINARY}"

  echo "Installed actionlint v${VERSION} to ${BINARY}"
fi

# Run actionlint (action dists are built via nopo check dependencies: statemachine:compile, claude:compile)
exec "${BINARY}" "$@"
