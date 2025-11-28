ARG APP_USER=nopoapp
ARG APP_UID=1001
ARG APP_GID=1001

################################################################################################
FROM node:22.16.0-slim AS os
################################################################################################

ARG APP_USER
ARG APP_UID
ARG APP_GID
ARG SERVICE_NAME=

ENV APP_HOME="/home/${APP_USER}"
ENV APP="/app"
ENV NOPO_CORE="/opt/nopo-core"
ENV PNPM_STORE_DIR="${APP_HOME}/.local/share/pnpm/store"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV UV_HOME="${APP_HOME}/.uv"
ENV UV_CACHE_DIR="${UV_HOME}/cache"
ENV UV_PROJECT_ENVIRONMENT="${APP_HOME}/.venv"
ENV UV_PYTHON_INSTALL_DIR="${UV_HOME}/python"
ENV UV_COMPILE_BYTECODE=1
ENV UV_MANAGED_PYTHON=1
ENV VIRTUAL_ENV="${UV_PROJECT_ENVIRONMENT}"
ENV PYTHONUNBUFFERED=1
ENV RUST_LOG=uv=debug
ENV XDG_CACHE_HOME="${APP_HOME}/.cache"
ENV XDG_CONFIG_HOME="${APP_HOME}/.config"
ENV XDG_DATA_HOME="${APP_HOME}/.local/share"
ENV PATH="${NOPO_CORE}/bin:/usr/local/bin:${PATH}"

WORKDIR ${APP}

RUN groupadd -g ${APP_GID} ${APP_USER} && \
    useradd -r -u ${APP_UID} -g ${APP_GID} -d ${APP_HOME} -m -s /bin/bash ${APP_USER}

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      make \
      python3 \
      python3-pip \
      python3-venv \
      tini && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p \
      ${NOPO_CORE}/bin \
      ${PNPM_STORE_DIR} \
      ${UV_HOME} \
      ${UV_CACHE_DIR} \
      ${UV_PROJECT_ENVIRONMENT} \
      ${APP_HOME}/deps \
      ${APP_HOME}/.cache \
      ${APP_HOME}/.config \
      ${APP} && \
    chown -R root:root ${NOPO_CORE} && \
    chmod -R 755 ${NOPO_CORE} && \
    chown -R ${APP_USER}:${APP_USER} ${APP_HOME} ${APP}

COPY --from=ghcr.io/astral-sh/uv:latest --chown=root:root /uv ${NOPO_CORE}/bin/uv
COPY --from=ghcr.io/astral-sh/uv:latest --chown=root:root /uvx ${NOPO_CORE}/bin/uvx
RUN ln -sf ${NOPO_CORE}/bin/uv /usr/local/bin/uv && \
    ln -sf ${NOPO_CORE}/bin/uvx /usr/local/bin/uvx

RUN npm install --global corepack@latest pnpm@9.12.3

COPY .python-version /tmp/.python-version

USER ${APP_USER}
RUN uv python install "$(cat /tmp/.python-version)"
USER root
RUN rm -f /tmp/.python-version

COPY apps/backend/pyproject.toml /tmp/backend/pyproject.toml
COPY apps/backend/uv.lock /tmp/backend/uv.lock
RUN chown -R ${APP_USER}:${APP_USER} /tmp/backend
USER ${APP_USER}
RUN cd /tmp/backend && uv sync --locked --no-install-workspace --preview
USER root
RUN rm -rf /tmp/backend

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
FROM os AS user
################################################################################################

COPY --from=info /build-info.json /build-info.json

RUN <<'EOF'
cat <<'INNEREOF' > /cmd.sh
#!/bin/bash

service="${SERVICE_NAME:-}"
command="${SERVICE_COMMAND:-}"

if [[ -z "${service}" ]]; then
  echo "SERVICE_NAME is not set"
  exit 1
fi

if [[ -z "${command}" ]]; then
  echo "SERVICE_COMMAND is not set"
  exit 1
fi

set -xue
pnpm --filter "@more/${service}" "${command}"
INNEREOF

chmod +x /cmd.sh
EOF

USER ${APP_USER}
CMD ["/cmd.sh"]

################################################################################################
FROM user AS development
################################################################################################

ENV SERVICE_COMMAND="dev"

################################################################################################
FROM user AS production
################################################################################################

ENV SERVICE_COMMAND="start"
