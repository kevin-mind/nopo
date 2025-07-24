ARG USER=nodeuser
ARG USER_ID=1001

################################################################################################
FROM node:22.16.0-slim AS os
################################################################################################

ARG USER
ARG USER_ID

ARG SERVICE_NAME=
ENV HOME=/home/${USER}
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
ENV PNPM_VIRTUAL_STORE_DIR="${APP}/node_modules/.pnpm"
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

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
<<EOF
apt-get update
apt-get install -y --no-install-recommends make jq curl
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
apt-get install -y --no-install-recommends make jq curl
EOF

RUN --mount=type=bind,source=.python-version,target=$APP/.python-version <<EOF
uv venv
EOF

RUN --mount=type=bind,source=package.json,target=$APP/package.json <<EOF
npm install --global corepack@latest
corepack enable pnpm
corepack prepare pnpm --activate
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
# Set permissions to make the file readable by all but only writable by root
chmod 644 /build-info.json
cat /build-info.json
EOF

################################################################################################
FROM base AS source
################################################################################################

COPY . $APP

################################################################################################
FROM os AS source_uv
################################################################################################

COPY --from=source $APP $APP
RUN <<EOF
find "$APP" -type f \
  ! -name 'pyproject.toml' \
  ! -name 'uv.lock' \
  -delete
EOF

################################################################################################
FROM base AS install_uv
################################################################################################

COPY --from=source_uv --chown=$USER $APP $APP

RUN <<EOF
uv sync --locked --no-install-workspace --active
EOF

################################################################################################
FROM os AS source_pnpm
################################################################################################

COPY --from=source --chown=$USER $APP $APP

RUN <<EOF
find "$APP" -type f \
  ! -name 'package.json' \
  ! -name 'pnpm-lock.yaml' \
  ! -name 'pnpm-workspace.yaml' \
  -delete
EOF

################################################################################################
FROM base AS install_pnpm
################################################################################################

COPY --from=source_pnpm $APP $APP

RUN <<EOF
pnpm fetch
EOF

################################################################################################
FROM base AS build
################################################################################################

COPY --from=install_uv --chown=$USER $UV_HOME $UV_HOME
COPY --from=install_pnpm --chown=$USER $PNPM_HOME $PNPM_HOME
COPY --from=source --chown=$USER $APP $APP

RUN <<EOF
uv sync --locked --offline
EOF

RUN <<EOF
pnpm install --frozen-lockfile --offline
EOF

RUN <<EOF
pnpm -r build
EOF

################################################################################################
FROM base AS user
################################################################################################

COPY --from=base --chown=$USER $HOME $HOME
COPY --from=info /build-info.json /build-info.json
COPY --from=install_uv --chown=$USER $UV_HOME $UV_HOME
COPY --from=install_pnpm --chown=$USER $PNPM_HOME $PNPM_HOME
COPY --from=source --chown=$USER $APP/docker/cmd.sh /cmd.sh

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

RUN <<EOF
pnpm install --frozen-lockfile --offline --prod
EOF

RUN <<EOF
uv sync --locked --offline --no-dev
EOF
