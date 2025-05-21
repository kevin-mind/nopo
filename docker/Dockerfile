ARG USER=nodeuser

################################################################################################
FROM node:20-slim AS base
################################################################################################

# Specify the custom entrypoint for the container
COPY docker/entrypoint.sh /
RUN chmod 555 /entrypoint.sh
ENTRYPOINT [ "/entrypoint.sh" ]

ARG USER
ARG NODE_ENV=production

ENV SERVICE_NAME=
ENV NODE_ENV=$NODE_ENV

ENV BUILD_INFO=/build-info.json
ENV HOME=/home/nodeuser
ENV APP=/app
ENV DEPS=$HOME/deps
ENV PNPM_HOME="$DEPS/pnpm"
ENV PNPM_STORE_DIR="$PNPM_HOME/store"
ENV COREPACK_HOME="$DEPS/corepack"
ENV PATH="$PNPM_HOME:$COREPACK_HOME:$PATH"

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
  --mount=type=bind,source=package.json,target=$APP/package.json \
  --mount=type=bind,source=.npmrc,target=$APP/.npmrc \
<<EOF
apt-get update && apt-get install -y make jq
corepack enable pnpm
corepack prepare pnpm --activate
corepack install -g pnpm
EOF

FROM base AS info

# Build args that represent static build information
# These are passed to docker via the bake.hcl file and
# should not be overridden in the container environment.
ARG DOCKER_COMMIT
ARG DOCKER_VERSION
ARG DOCKER_BUILD
ARG DOCKER_TARGET

RUN <<EOF
cat <<INNEREOF > ${BUILD_INFO}
{
  "commit": "${DOCKER_COMMIT}",
  "version": "${DOCKER_VERSION}",
  "build": "${DOCKER_BUILD}",
  "target": "${DOCKER_TARGET}",
  "source": "https://github.com/kevin-mind/nopo"
}
INNEREOF
# Set permissions to make the file readable by all but only writable by root
chmod 644 ${BUILD_INFO}
EOF

FROM base AS user

RUN <<EOF
groupadd -g 1001 $USER
useradd -r -u 1001 -g 1001 -d $HOME -m -s /sbin/nologin $USER

# Create directories and set permissions
for dir in $APP $DEPS $PNPM_HOME $PNPM_STORE_DIR $COREPACK_HOME; do
  mkdir -p $dir
  chown -R $USER:$USER $dir
  chmod -R g+rwx $dir
done
EOF

WORKDIR $APP

USER $USER

################################################################################################
FROM base AS source
################################################################################################

COPY . $APP

################################################################################################
FROM user AS install
################################################################################################

COPY --from=source --chown=$USER \
  $APP/.npmrc $APP/pnpm-lock.yaml $APP/pnpm-workspace.yaml \
  $APP/

RUN --mount=type=bind,source=.npmrc,target=$APP/.npmrc \
  --mount=type=bind,source=pnpm-lock.yaml,target=$APP/pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=$APP/pnpm-workspace.yaml \
  npm_config_offline=false pnpm fetch

################################################################################################
FROM user AS build
################################################################################################

COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $APP $APP

RUN <<EOF
pnpm install
pnpm build
EOF

################################################################################################
FROM user AS development
################################################################################################
COPY --from=info ${BUILD_INFO} ${BUILD_INFO}
COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $APP $APP

CMD pnpm --filter "@more/${SERVICE_NAME}" dev

################################################################################################
FROM user AS production
################################################################################################
COPY --from=info ${BUILD_INFO} ${BUILD_INFO}
COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=build --chown=$USER $APP $APP

RUN pnpm install --prod --config.confirmModulesPurge=false

CMD pnpm --filter "@more/${SERVICE_NAME}" start

