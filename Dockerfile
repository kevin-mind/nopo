ARG USER=nodeuser

################################################################################################
FROM node:20-slim AS base
################################################################################################

SHELL ["/bin/bash", "-eo", "pipefail", "-c"]

ARG USER
ARG NODE_ENV=production

ENV NODE_ENV=$NODE_ENV
ENV HOME=/app
ENV DEPS=/deps
ENV PNPM_HOME="$DEPS/pnpm"
ENV PNPM_STORE_DIR="$PNPM_HOME/store"
ENV COREPACK_HOME="$DEPS/corepack"
ENV PATH="$PNPM_HOME:$COREPACK_HOME:$PATH"

RUN <<EOF
groupadd -g 1001 $USER
useradd -r -u 1001 -g 1001 -d $HOME $USER

# Create directories and set permissions
for dir in $HOME $DEPS $PNPM_HOME $PNPM_STORE_DIR $COREPACK_HOME; do
  mkdir -p $dir
  chown -R $USER:$USER $dir
  chmod -R g+rwx $dir
done
EOF

WORKDIR $HOME

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
  --mount=type=bind,source=package.json,target=$HOME/package.json \
  --mount=type=bind,source=.npmrc,target=$HOME/.npmrc \
<<EOF
apt-get update && apt-get install -y make jq
corepack enable pnpm
corepack install -g pnpm
# Make sure that any files created in $DEPS are owned by $USER
chown -R $USER:$USER $DEPS
EOF

USER $USER

################################################################################################
FROM base AS source
################################################################################################

COPY . $HOME

################################################################################################
FROM base AS install
################################################################################################

COPY --from=source --chown=$USER \
  $HOME/.npmrc $HOME/pnpm-lock.yaml $HOME/pnpm-workspace.yaml \
  $HOME/

RUN --mount=type=bind,source=.npmrc,target=$HOME/.npmrc \
  --mount=type=bind,source=pnpm-lock.yaml,target=$HOME/pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=$HOME/pnpm-workspace.yaml \
  npm_config_offline=false pnpm fetch

################################################################################################
FROM base AS build
################################################################################################

COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $HOME $HOME

RUN <<EOF
pnpm install
pnpm build
EOF

################################################################################################
FROM base AS development
################################################################################################
COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $HOME $HOME

################################################################################################
FROM base AS production
################################################################################################

COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=build --chown=$USER $HOME $HOME

RUN pnpm install --prod
