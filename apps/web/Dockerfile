ARG SERVICE_NAME
ARG NOPO_APP_UID
ARG NOPO_APP_GID

FROM base AS web-build

ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --chown=${NOPO_APP_UID}:${NOPO_APP_GID} . .

RUN pnpm install --frozen-lockfile
RUN NODE_ENV=production pnpm --filter @more/web build

FROM base AS web

ARG SERVICE_NAME
ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --from=web-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} ${APP} ${APP}
COPY --from=web-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} ${HOME} ${HOME}

ENV SERVICE_NAME=${SERVICE_NAME}
