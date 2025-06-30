#!/bin/bash

set -xue

if [[ $(id -u) -ne 0 ]]; then
  echo "This must be run as root"
  exit 1
fi

USER_NAME="nodeuser"
USER_UID=$(id -u "${USER_NAME}")
TARGET_UID="${HOST_UID:-USER_UID}"

# If the host uid and user uid don't match, prefer the host uid
if [[ "${TARGET_UID}" != "${USER_UID}" ]]; then
  usermod -u "${TARGET_UID}" -o "${USER_NAME}"
fi

cat <<EOF | su -s /bin/bash "${USER_NAME}"
  yes | pnpm install

  rm -rf "${UV_PROJECT_ENVIRONMENT:-.venv}"
  uv sync

  pnpm build
EOF
