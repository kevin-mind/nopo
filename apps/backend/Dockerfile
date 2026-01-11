ARG NOPO_BASE_IMAGE=base
ARG SERVICE_NAME
ARG NOPO_APP_UID
ARG NOPO_APP_GID

FROM ${NOPO_BASE_IMAGE} AS backend-build

ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --chown=${NOPO_APP_UID}:${NOPO_APP_GID} . .

RUN pnpm install --frozen-lockfile
RUN NODE_ENV=production pnpm --filter @more/backend build

FROM ${NOPO_BASE_IMAGE} AS backend

ARG SERVICE_NAME
ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --from=backend-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} ${APP} ${APP}
COPY --from=backend-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} ${HOME} ${HOME}

ENV SERVICE_NAME=${SERVICE_NAME}
