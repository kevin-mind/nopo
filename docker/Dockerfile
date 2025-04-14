ARG APP_NAME
ARG TURBO_VERSION

################################################################################################
FROM node:20-slim AS base
################################################################################################

SHELL ["/bin/bash", "-c"]

ARG NODE_ENV

ENV HOME=/app
ENV NODE_ENV=$NODE_ENV
ENV PATH=$HOME/node_modules/.bin:$PATH

WORKDIR $HOME

# Install make
RUN apt-get update && apt-get install -y make

################################################################################################
FROM base AS source
################################################################################################

ARG TURBO_VERSION
ARG APP_NAME

COPY . $HOME

RUN npx turbo@${TURBO_VERSION} prune "${APP_NAME}" --docker

################################################################################################
FROM base AS dependencies
################################################################################################

COPY --from=source $HOME/out/json $HOME

RUN npm ci --no-fund --install-strategy=hoisted

################################################################################################
FROM dependencies AS build
################################################################################################

ARG APP_NAME

COPY --from=source $HOME/out/full $HOME

# Install full dependencies so we can build the application
RUN npm install
RUN npm run build --filter=$APP_NAME

################################################################################################
FROM base AS development
################################################################################################

COPY --from=dependencies $HOME $HOME
COPY --from=source $HOME $HOME

CMD ["npm", "run", "dev"]

################################################################################################
FROM dependencies AS production
################################################################################################

ARG APP_NAME

COPY --from=build $HOME/$APP_NAME/build $HOME/$APP_NAME/build

CMD ["npm", "run", "start"]
