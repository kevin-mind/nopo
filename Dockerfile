################################################################################################
FROM node:20-slim AS base
################################################################################################

SHELL ["/bin/bash", "-eo", "pipefail", "-c"]

ARG NODE_ENV=production

ENV NODE_ENV=$NODE_ENV
ENV HOME=/app
ENV PNPM_HOME="/pnpm"
ENV PNPM_STORE_DIR="${PNPM_HOME}/store"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR $HOME

RUN \
  --mount=type=cache,target=/var/cache/apt,id=apt \
  --mount=type=cache,target=/var/lib/apt,id=apt \
<<EOF
apt-get update && apt-get install -y make jq
EOF

RUN npm install -g pnpm

################################################################################################
FROM base AS source
################################################################################################

COPY . $HOME

################################################################################################
FROM base AS install_dev
################################################################################################

COPY --from=source $HOME $HOME

RUN --mount=type=cache,id=pnpm,target=$PNPM_STORE_DIR <<EOF
pnpm install
EOF

################################################################################################
FROM base AS install_prod
################################################################################################

COPY --from=source $HOME $HOME

RUN --mount=type=cache,id=pnpm,target=$PNPM_STORE_DIR <<EOF
pnpm install --prod
EOF

################################################################################################
FROM base AS build
################################################################################################

COPY --from=install_dev $HOME $HOME
COPY --from=source $HOME $HOME

RUN pnpm run -r build

################################################################################################
FROM base AS development
################################################################################################

COPY --from=install_dev $HOME $HOME
COPY --from=source $HOME $HOME

################################################################################################
FROM base AS production
################################################################################################

COPY --from=install_prod $HOME $HOME
COPY --from=build $HOME $HOME
