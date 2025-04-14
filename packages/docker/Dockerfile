ARG APP_NAME

################################################################################################
FROM node:20-slim AS base
################################################################################################

SHELL ["/bin/bash", "-eo", "pipefail", "-c"]

ARG NODE_ENV

ENV HOME=/app
ENV NODE_ENV=$NODE_ENV
ENV PATH=$HOME/node_modules/.bin:$PATH

WORKDIR $HOME

# Install make
RUN apt-get update && apt-get install -y make jq

################################################################################################
FROM base AS source
################################################################################################

ARG APP_NAME

COPY . $HOME

RUN <<EOF
if [ -d "node_modules" ]; then
  echo "node_modules exists. This should NOT happen."
  exit 1
fi
EOF

RUN <<EOF
npx --yes turbo prune "${APP_NAME}" --docker
EOF

################################################################################################
FROM base AS dependencies
################################################################################################

COPY --from=source $HOME/out/json $HOME

RUN npm ci --no-fund

################################################################################################
FROM dependencies AS build
################################################################################################

ARG APP_NAME

COPY --from=source $HOME/out/full $HOME

# Install full dependencies so we can build the application
RUN npm ci --include=dev --no-fund
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

COPY --from=build $HOME/apps/$APP_NAME/build $HOME/apps/$APP_NAME/build

CMD ["npm", "run", "start"]
