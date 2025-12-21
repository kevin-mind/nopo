ARG NOPO_BASE_IMAGE=nopo:latest
ARG SERVICE_NAME=backend
ARG NOPO_APP_UID=1001
ARG NOPO_APP_GID=1001

FROM ${NOPO_BASE_IMAGE} AS backend-build

ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --chown=${NOPO_APP_UID}:${NOPO_APP_GID} . .

RUN pnpm install --filter "@more/backend" --frozen-lockfile
RUN pnpm --filter "@more/backend" build

FROM ${NOPO_BASE_IMAGE} AS backend

ARG SERVICE_NAME
ARG NOPO_APP_UID
ARG NOPO_APP_GID

COPY --from=backend-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} /app /app
COPY --from=backend-build --chown=${NOPO_APP_UID}:${NOPO_APP_GID} /home/nopoapp /home/nopoapp

ENV SERVICE_NAME=${SERVICE_NAME}
