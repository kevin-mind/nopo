ARG NOPO_BASE_IMAGE=nopo:latest
ARG SERVICE_NAME

FROM ${NOPO_BASE_IMAGE} AS web-build

COPY --chown=nopoapp:nopoapp . .

RUN pnpm install --filter "@more/web" --frozen-lockfile
RUN pnpm --filter "@more/web" build

FROM ${NOPO_BASE_IMAGE} AS web

ARG SERVICE_NAME

COPY --from=web-build --chown=nopoapp:nopoapp /app /app
COPY --from=web-build --chown=nopoapp:nopoapp /home/nopoapp /home/nopoapp

ENV SERVICE_NAME=${SERVICE_NAME}
