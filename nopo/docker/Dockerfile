ARG BASE_FROM=node:22.16.0-slim
ARG OS_PACKAGES="make jq curl"
ARG USER=nopoapp
ARG USER_ID=1001
ARG USER_HOME=/home/nopoapp

################################################################################################
FROM ${BASE_FROM} AS os
################################################################################################

ARG USER
ARG USER_ID
ARG USER_HOME
ARG OS_PACKAGES

# Export for child images (must match NOPO_APP_UID/GID used by build script)
ENV NOPO_APP_UID="${USER_ID}"
ENV NOPO_APP_GID="${USER_ID}"

ENV HOME=${USER_HOME}
ENV APP=/app
ENV DEPS=${HOME}/deps

RUN <<EOF
# Create user and group
groupadd -g $USER_ID $USER
useradd -r -u $USER_ID -g $USER_ID -d $HOME -m -s /bin/bash $USER
EOF

# PNPM constant environment variables
ENV PNPM_HOME="${DEPS}/pnpm"
ENV PNPM_STORE_DIR="${PNPM_HOME}/store"
ENV COREPACK_HOME="${DEPS}/corepack"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# UV constant environment variables
ENV UV_HOME="${DEPS}/uv"
ENV UV_BIN="${UV_HOME}/bin"
ENV UV_PYTHON_INSTALL_DIR="${UV_HOME}/python"
ENV UV_COMPILE_BYTECODE=1
ENV UV_CACHE_DIR="${UV_HOME}/cache"
ENV UV_PROJECT_ENVIRONMENT="${UV_HOME}/venv"
ENV UV_MANAGED_PYTHON=1
ENV VIRTUAL_ENV="${UV_PROJECT_ENVIRONMENT}"
ENV XDG_BIN_HOME="${UV_BIN}"
ENV PYTHONUNBUFFERED=1
ENV RUST_LOG=uv=debug

ENV PATH="${PNPM_HOME}:${COREPACK_HOME}:${UV_BIN}:${UV_HOME}:${PATH}"

WORKDIR $APP

# Ensure /app is owned by the user
RUN mkdir -p $APP && chown -R $USER:$USER $APP

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
<<EOF
apt-get update
if [ -n "${OS_PACKAGES}" ]; then
  apt-get install -y --no-install-recommends ${OS_PACKAGES}
fi
EOF

################################################################################################
FROM os AS base
################################################################################################

COPY --from=ghcr.io/astral-sh/uv:latest --chown="${USER}:${USER}" /uv /uvx /bin/

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
<<EOF
apt-get update
if [ -n "${OS_PACKAGES}" ]; then
  apt-get install -y --no-install-recommends ${OS_PACKAGES}
fi
EOF

RUN --mount=type=bind,source=.python-version,target=$APP/.python-version <<EOF
uv venv
EOF

RUN --mount=type=bind,source=package.json,target=$APP/package.json <<EOF
npm install --global corepack@latest
corepack enable pnpm
corepack prepare pnpm --activate
# Install tsx globally so we can run TypeScript directly
npm install --global tsx@latest
EOF

# Create nopo wrapper script that uses tsx to run TypeScript directly
# This avoids needing to build nopo separately and conflicting with workspace install
RUN <<EOF
cat > /usr/local/bin/nopo <<'WRAPPER'
#!/bin/bash
exec tsx /app/nopo/scripts/bin.ts "$@"
WRAPPER
chmod +x /usr/local/bin/nopo
EOF

################################################################################################
FROM os AS info
################################################################################################

# Build args that represent static build information
# These are passed to docker via the bake.hcl file and
# should not be overridden in the container environment.
ARG GIT_REPO
ARG GIT_BRANCH
ARG GIT_COMMIT
ARG DOCKER_VERSION
ARG DOCKER_BUILD
ARG DOCKER_TARGET
ARG DOCKER_TAG

RUN <<EOF
cat <<INNEREOF > /build-info.json
{
  "repo": "${GIT_REPO}",
  "branch": "${GIT_BRANCH}",
  "commit": "${GIT_COMMIT}",
  "version": "${DOCKER_VERSION}",
  "tag": "${DOCKER_TAG}",
  "build": "${DOCKER_BUILD}",
  "target": "${DOCKER_TARGET}"
}
INNEREOF
chmod 644 /build-info.json
cat /build-info.json
EOF

################################################################################################
FROM base AS user
################################################################################################

ARG SERVICE_NAME=

COPY --from=base --chown=$USER $HOME $HOME
COPY --from=info /build-info.json /build-info.json

RUN <<EOF
cat <<'INNEREOF' > /cmd.sh
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

set -xue
nopo "${command}" "${service}"
INNEREOF

chmod +x /cmd.sh

EOF

CMD ["/cmd.sh"]

USER $USER

################################################################################################
FROM user AS development
################################################################################################

ENV SERVICE_COMMAND="dev"

################################################################################################
FROM user AS production
################################################################################################

ENV SERVICE_COMMAND="start"
