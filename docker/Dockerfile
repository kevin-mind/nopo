ARG USER=nodeuser
ARG USER_ID=1001

################################################################################################
FROM node:22.16.0-slim AS base
################################################################################################

ARG USER
ARG USER_ID
ARG NODE_ENV=production

ENV SERVICE_NAME=
ENV NODE_ENV=$NODE_ENV

ENV BUILD_INFO=/build-info.json
ENV HOME=/home/$USER
ENV APP=/app
ENV DEPS=$HOME/deps
ENV PNPM_HOME="$DEPS/pnpm"
ENV PNPM_STORE_DIR="$PNPM_HOME/store"
ENV COREPACK_HOME="$DEPS/corepack"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV UV_COMPILE_BYTECODE=1
ENV UV_CACHE_DIR="$DEPS/uv-cache"
# Configure UV to use .venv in the project root
ENV UV_PROJECT_ENVIRONMENT="$APP/.venv"
ENV UV_PYTHON_PREFERENCE=only-managed
ENV PYTHONUNBUFFERED=1
ENV PATH="$PNPM_HOME:$COREPACK_HOME:$PATH"

WORKDIR $APP

RUN <<EOF
# Create user and group
groupadd -g $USER_ID $USER
useradd -r -u $USER_ID -g $USER_ID -d $HOME -m -s /bin/bash $USER
EOF

COPY --from=ghcr.io/astral-sh/uv:latest --chown=$USER:$USER /uv /uvx /bin/

RUN \
  --mount=type=bind,source=.python-version,target=$APP/.python-version \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
  --mount=type=bind,source=package.json,target=$APP/package.json \
  --mount=type=cache,target=$PNPM_HOME,id=pnpm \
  --mount=type=cache,target=$COREPACK_HOME,id=corepack \
  --mount=type=cache,target=$PNPM_STORE_DIR,id=pnpm-store \
<<EOF
apt-get update
apt-get install -y --no-install-recommends make jq curl
uv python install
npm install --global corepack@latest
corepack enable pnpm
corepack prepare pnpm --activate
EOF

################################################################################################
FROM base AS info
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
FROM base AS source
################################################################################################

COPY . $APP

################################################################################################
FROM base AS install
################################################################################################

ARG USER_ID

COPY --from=source --chown=$USER \
  $APP/pnpm-lock.yaml \
  $APP/pnpm-workspace.yaml \
  $APP/pyproject.toml \
  $APP/uv.lock \
  $APP/

# Install or sync Python dependencies in development mode
# The .venv will be created in $APP/.venv and will be mounted from host in development
RUN <<EOF
set -e
# Create empty .venv directory structure so UV can work
mkdir -p $APP/.venv
# In build context, we install base dependencies but allow mounting to override
uv sync --frozen --no-install-workspace || true
pnpm fetch
EOF

################################################################################################
FROM base AS build
################################################################################################

COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $APP $APP

RUN <<EOF
pnpm "/^install:offline.*/"
pnpm "/^build.*/"
EOF

################################################################################################
FROM base AS user
################################################################################################

COPY --from=base --chown=$USER $HOME $HOME
COPY --from=info ${BUILD_INFO} ${BUILD_INFO}
COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $APP/docker/cmd.sh /cmd.sh

# Create a wrapper script for UV commands that ensures venv is in sync
RUN <<EOF
cat > /usr/local/bin/uv-run << 'INNEREOF'
#!/bin/bash
set -e

# Source UV environment
source $HOME/.local/bin/env 2>/dev/null || true

# Ensure .venv exists and is in sync
if [ ! -d "$APP/.venv" ] || [ ! -f "$APP/.venv/pyvenv.cfg" ]; then
    echo "Creating or repairing virtual environment..."
    cd $APP
    uv sync --frozen 2>/dev/null || true
fi

# Run the command with uv
exec uv "$@"
INNEREOF
chmod +x /usr/local/bin/uv-run
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

COPY --from=build --chown=$USER $APP $APP

# In production, we want a complete .venv
RUN <<EOF
cd $APP
uv sync --frozen --no-dev
pnpm "/^install:prod.*/"
EOF
