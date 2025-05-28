ARG USER=nodeuser
ARG USER_UID=1001

################################################################################################
FROM --platform=amd64 node:20-slim AS base
################################################################################################

ARG USER
ARG USER_UID

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
ENV PATH="$PNPM_HOME:$COREPACK_HOME:$PATH"

WORKDIR $APP

RUN <<EOF
groupadd -g ${USER_UID} "${USER}"
useradd \
  --uid ${USER_UID} \
  --gid ${USER_UID} \
  --home-dir ${HOME} \
  --create-home \
  --shell /bin/bash \
  "${USER}"
for dir in $APP $DEPS $PNPM_HOME $PNPM_STORE_DIR $COREPACK_HOME; do
  mkdir -p "${dir}"
  chown -R "${USER}:${USER}" "${dir}"
done
EOF

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
  --mount=type=bind,source=package.json,target=$APP/package.json \
<<EOF
apt-get update && apt-get install -y make jq
corepack enable pnpm
corepack prepare pnpm --activate
corepack install -g pnpm
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
FROM base AS user
################################################################################################

USER $USER

################################################################################################
FROM user AS install
################################################################################################

RUN --mount=type=bind,source=pnpm-lock.yaml,target=$APP/pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=$APP/pnpm-workspace.yaml \
  pnpm fetch --dir $PNPM_HOME

################################################################################################
FROM base AS git
################################################################################################

RUN apt-get update && apt-get install -y git sudo

################################################################################################
FROM base AS devcontainer
################################################################################################

COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=info ${BUILD_INFO} ${BUILD_INFO}

ARG USER
USER $USER

# RUN <<EOF
# build_info=$(cat ${BUILD_INFO})
# repo=$(echo $build_info | jq -r '.repo')
# branch=$(echo $build_info | jq -r '.branch')
# clone="git clone ${repo}"
# if [ -n "${branch}" ]; then
#   clone="${clone} -b ${branch}"
# fi
# bash -c "${clone} ${APP}"
# git config --global --add safe.directory ${APP}
# EOF

################################################################################################
FROM user AS build
################################################################################################

COPY --from=install --chown=$USER $DEPS $DEPS
COPY --from=source --chown=$USER $APP $APP

RUN <<EOF
pnpm install:lock
pnpm build
EOF

################################################################################################
FROM base AS runner
################################################################################################

RUN <<EOF
chsh -s /sbin/nologin $USER
EOF

USER $USER

COPY --from=info ${BUILD_INFO} ${BUILD_INFO}
COPY --from=install --chown=$USER $DEPS $DEPS

COPY docker/cmd.sh /cmd.sh
CMD ["/cmd.sh"]

################################################################################################
FROM runner AS development
################################################################################################

COPY --from=source --chown=$USER $APP $APP

ENV SERVICE_COMMAND="dev"

################################################################################################
FROM runner AS production
################################################################################################

COPY --from=build --chown=$USER $APP $APP

RUN pnpm install:lock --prod

ENV SERVICE_COMMAND="start"
