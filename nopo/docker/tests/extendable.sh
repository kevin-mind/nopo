#!/usr/bin/env bash
set -euo pipefail

BASE_IMAGE="${1:-${DOCKER_TAG:-kevin-mind/nopo:local}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat >"${TMP_DIR}/Dockerfile" <<'EOF'
ARG NOPO_BASE_IMAGE
FROM ${NOPO_BASE_IMAGE}

RUN <<'INNER'
set -eux
mkdir -p /tmp/verification
chown nopoapp:nopoapp /tmp/verification
INNER

USER nopoapp
WORKDIR /tmp/verification

RUN <<'INNER'
set -eux
mkdir -p /tmp/pkg/package
cat <<'PKG' > /tmp/pkg/package/package.json
{
  "name": "extend-check",
  "version": "1.0.0",
  "main": "index.js"
}
PKG
echo "module.exports = () => 'ok';" > /tmp/pkg/package/index.js
tar -czf /tmp/extend-check-1.0.0.tgz -C /tmp/pkg package
cat <<'PKG' > package.json
{
  "name": "verification",
  "version": "1.0.0"
}
PKG
pnpm add file:/tmp/extend-check-1.0.0.tgz
test ! -w /opt/nopo-core
INNER

CMD ["cat", "/build-info.json"]
EOF

IMAGE_TAG="nopo/extendable-test:latest"

echo "Verifying extendable contract with base image '${BASE_IMAGE}'"
docker build --build-arg NOPO_BASE_IMAGE="${BASE_IMAGE}" -t "${IMAGE_TAG}" "${TMP_DIR}" >/dev/null
BUILD_INFO="$(docker run --rm "${IMAGE_TAG}")"

BUILD_INFO="${BUILD_INFO}" EXPECTED_TAG="${BASE_IMAGE}" python3 <<'PY'
import json
import os
import sys
info = json.loads(os.environ["BUILD_INFO"])
expected = os.environ["EXPECTED_TAG"]
if info.get("tag") != expected:
    print(f"Expected base tag {expected} but found {info.get('tag')}", file=sys.stderr)
    sys.exit(1)
PY

echo "Extendable image verification passed."
