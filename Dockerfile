FROM node:20-slim AS base

SHELL ["/bin/bash", "-c"]

ARG NODE_ENV=undefined

ENV PORT=5173
ENV HOST=0.0.0.0
ENV HOME=/app
ENV NODE_ENV=$NODE_ENV
ENV PATH=$HOME/node_modules/.bin:$PATH

WORKDIR $HOME

RUN <<EOF
  if [ "$NODE_ENV" = "undefined" ]; then
    echo "NODE_ENV is undefined"
    exit 1
  fi
EOF

FROM base AS source

COPY . $HOME

FROM base AS dependencies

RUN \
  --mount=type=bind,source=package.json,target=$HOME/package.json \
  --mount=type=bind,source=package-lock.json,target=$HOME/package-lock.json \
  npm ci

FROM base AS development

COPY --from=dependencies $HOME/node_modules $HOME/node_modules
COPY --from=source $HOME $HOME

CMD ["npm", "run", "dev", "--", "--host"]

FROM base AS build

COPY --from=source $HOME $HOME

RUN <<EOF
NODE_ENV=development npm install
npm run build
EOF

FROM base AS production

COPY --from=dependencies $HOME/node_modules $HOME/node_modules
COPY --from=build $HOME/build $HOME/build
COPY --from=source $HOME $HOME

CMD ["npm", "run", "start"]
