ARG NOPO_BASE_IMAGE=nopo:latest
ARG SERVICE_NAME

FROM ${NOPO_BASE_IMAGE} AS backend-build

COPY --chown=nopoapp:nopoapp . .

RUN pnpm install --filter "@more/backend" --frozen-lockfile
RUN pnpm --filter "@more/backend" build

FROM ${NOPO_BASE_IMAGE} AS backend

ARG SERVICE_NAME

COPY --from=backend-build --chown=nopoapp:nopoapp /app /app
COPY --from=backend-build --chown=nopoapp:nopoapp /home/nopoapp /home/nopoapp

ENV SERVICE_NAME=${SERVICE_NAME}
