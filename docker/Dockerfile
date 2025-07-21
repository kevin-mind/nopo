################################################################################################
FROM node:22.16.0-slim AS os
################################################################################################

# Create user and group for the container
RUN <<EOF
# Create user and group
groupadd -g 1001 nopo
useradd -r -u 1001 -g 1001 -d $HOME -m -s /bin/bash nopo
EOF

# Global constant environment variables
ENV FORCE_COLOR=1
ENV BUILD_INFO=/build-info.json
ENV HOME=/home/nopo
ENV APP=/app
ENV DEPS=$HOME/deps

# PNPM constant environment variables
ENV PNPM_HOME="$DEPS/pnpm"
ENV PNPM_STORE_DIR="$PNPM_HOME/store"
ENV PNPM_VIRTUAL_STORE_DIR="$APP/node_modules/.pnpm"
ENV COREPACK_HOME="$DEPS/corepack"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# UV constant environment variables
ENV UV_HOME="$DEPS/uv"
ENV UV_COMPILE_BYTECODE=1
ENV UV_CACHE_DIR="$UV_HOME/cache"
ENV UV_PROJECT_ENVIRONMENT=$UV_HOME/.venv
ENV UV_MANAGED_PYTHON=1
ENV PYTHONUNBUFFERED=1

# Paths needed for executing commands via uv and pnpm
ENV PATH="$PNPM_HOME:$COREPACK_HOME:$HOME/.local/bin:$PATH"

# Set the working directory for the container in all subsequent stages
WORKDIR $APP

################################################################################################
FROM os AS base
################################################################################################

COPY --from=ghcr.io/astral-sh/uv:latest --chown="nopo:nopo" /uv /uvx /bin/

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
  --mount=type=bind,source=.python-version,target=$APP/.python-version \
<<EOF
# Install global system dependencies
apt-get update
apt-get install -y --no-install-recommends make jq curl
# Install uv (and python) and pnpm
uv python install
npm install --global corepack@latest
corepack enable pnpm
corepack prepare pnpm --activate
EOF

ENV UV_PYTHON_DOWNLOADS=0

################################################################################################
FROM os AS source
################################################################################################

COPY . $APP

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
cat <<INNEREOF > ${BUILD_INFO}
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
# Set permissions to make the file readable by all but only writable by root
chmod 644 ${BUILD_INFO}
cat ${BUILD_INFO}
EOF

################################################################################################
FROM base AS installer_pnpm
################################################################################################

COPY --from=source --chown="nopo:nopo" \
  $APP/pnpm-lock.yaml \
  $APP/pnpm-workspace.yaml \
  $APP/

RUN pnpm fetch

################################################################################################
FROM base AS installer_uv
################################################################################################

COPY --from=source --chown="nopo:nopo" \
  $APP/pyproject.toml \
  $APP/uv.lock \
  $APP/

RUN uv sync --frozen --no-install-workspace --package nopo

################################################################################################
FROM base AS builder
################################################################################################

COPY --from=installer_uv --chown="nopo:nopo" $UV_HOME $UV_HOME
COPY --from=installer_pnpm --chown="nopo:nopo" $PNPM_HOME $PNPM_HOME
COPY --from=source --chown="nopo:nopo" $APP $APP

RUN <<EOF
set -e
uv sync --locked --package nopo
pnpm install --frozen-lockfile
EOF

RUN pnpm -r build

################################################################################################
FROM base AS runner
################################################################################################

COPY --from=info ${BUILD_INFO} ${BUILD_INFO}
COPY --from=installer_uv --chown="nopo:nopo" $UV_HOME $UV_HOME
COPY --from=installer_pnpm --chown="nopo:nopo" $PNPM_HOME $PNPM_HOME
COPY --from=source --chown="nopo:nopo" $APP/docker/cmd.sh /cmd.sh

CMD ["/cmd.sh"]

USER nopo

################################################################################################
FROM runner AS development
################################################################################################

ENV SERVICE_COMMAND="dev"

################################################################################################
FROM runner AS production
################################################################################################

ENV SERVICE_COMMAND="start"

COPY --from=builder --chown="nopo:nopo" $APP $APP

RUN <<EOF
set -e
uv sync --locked --no-dev --package nopo
pnpm install --frozen-lockfile --offline --prod
EOF
