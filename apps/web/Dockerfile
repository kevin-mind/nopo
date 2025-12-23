ARG NOPO_BASE_IMAGE
ARG SERVICE_NAME
ARG NOPO_APP_UID
ARG NOPO_APP_GID

FROM ${NOPO_BASE_IMAGE} AS web-build

ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --chown=${NOPO_APP_UID}:${NOPO_APP_GID} . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@more/web" build

FROM ${NOPO_BASE_IMAGE} AS web

ARG SERVICE_NAME
ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --from=web-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} /app /app
COPY --from=web-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} /home/nopoapp /home/nopoapp

ENV SERVICE_NAME=${SERVICE_NAME}
