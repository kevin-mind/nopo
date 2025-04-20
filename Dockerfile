ARG APP_NAME

################################################################################################
FROM node:20-slim AS base
################################################################################################

SHELL ["/bin/bash", "-eo", "pipefail", "-c"]

ARG NODE_ENV=production

ENV HOME=/app
ENV DEPLOY_PATH=/deploy
ENV BUILD_PATH=/app/build
ENV NODE_ENV=$NODE_ENV
ENV PNPM_HOME="/pnpm"
ENV PNPM_STORE_DIR="/pnpm/store"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR $HOME

# Install make/jq
RUN apt-get update && apt-get install -y make jq

# Install pnpm
RUN npm install -g pnpm

################################################################################################
FROM base AS source
################################################################################################

COPY . $HOME

################################################################################################
FROM source AS deploy_prod
################################################################################################

ARG APP_NAME

RUN \
    --mount=type=cache,id=pnpm,target=$PNPM_STORE_DIR \
    pnpm deploy --filter=${APP_NAME} --prod $DEPLOY_PATH

################################################################################################
FROM source AS deploy_dev
################################################################################################

ARG APP_NAME

RUN \
    --mount=type=cache,id=pnpm,target=$PNPM_STORE_DIR \
    pnpm deploy --filter=${APP_NAME} $DEPLOY_PATH

################################################################################################
FROM base AS build
################################################################################################

ARG APP_NAME

COPY --from=deploy_dev $DEPLOY_PATH $HOME
RUN pnpm --filter=${APP_NAME} run build

################################################################################################
FROM base AS development
################################################################################################

COPY --from=deploy_dev $DEPLOY_PATH $HOME

CMD ["pnpm", "run", "dev"]

################################################################################################
FROM base AS production
################################################################################################

COPY --from=build $HOME $HOME

CMD ["pnpm", "run", "start"]
