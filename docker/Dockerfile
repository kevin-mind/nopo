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
ENV PATH="$PNPM_HOME:$COREPACK_HOME:$PATH"

WORKDIR $APP

RUN <<EOF
# Create user and group
groupadd -g $USER_ID $USER
useradd -r -u $USER_ID -g $USER_ID -d $HOME -m -s /bin/bash $USER
EOF

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
  --mount=type=bind,source=package.json,target=$APP/package.json \
  --mount=type=cache,target=$PNPM_HOME,id=pnpm \
  --mount=type=cache,target=$COREPACK_HOME,id=corepack \
  --mount=type=cache,target=$PNPM_STORE_DIR,id=pnpm-store \
<<EOF
apt-get update && apt-get install -y make jq curl
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

COPY --from=source --chown=$USER $APP/pnpm-lock.yaml $APP/pnpm-workspace.yaml $APP/

RUN pnpm fetch

################################################################################################
FROM base AS build
################################################################################################

COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $APP $APP

RUN <<EOF
pnpm install:offline
pnpm build
EOF

################################################################################################
FROM base AS user
################################################################################################

COPY --from=info ${BUILD_INFO} ${BUILD_INFO}
COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $APP/docker/cmd.sh /cmd.sh

CMD ["/cmd.sh"]

RUN chown -R $USER:$USER $DEPS $APP $HOME

USER $USER

################################################################################################
FROM user AS runner
################################################################################################

USER root
RUN usermod -s /sbin/nologin $USER
USER $USER

################################################################################################
FROM runner AS development
################################################################################################

ENV SERVICE_COMMAND="dev"

COPY --from=source --chown=$USER $APP $APP

################################################################################################
FROM runner AS production
################################################################################################

ENV SERVICE_COMMAND="start"

COPY --from=build --chown=$USER $APP $APP

RUN pnpm install:offline --prod
