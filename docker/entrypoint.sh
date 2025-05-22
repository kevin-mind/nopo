#!/bin/bash

### This is the entrypoint script used for local and CI environments
### It allows the web/worker containers to be run as root, but execute
### the commands as the olympia user. This is necessary because the
### id of the olympia user sometimes should match the host user's id
### to avoid permission issues with mounted volumes.

set -xueo pipefail

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

echo "Running *@"
cat <<EOF | su -s /bin/bash ${USER_NAME}
  $@
EOF
