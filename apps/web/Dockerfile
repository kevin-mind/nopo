ARG NOPO_BASE_IMAGE=nopo:latest

FROM ${NOPO_BASE_IMAGE} AS web-build

# User and workdir are inherited from base image (nopoapp, /app)
# Use numeric UID:GID for COPY --chown (matches NOPO_APP_UID:NOPO_APP_GID from base)
COPY --chown=1001:1001 . .

RUN pnpm install --filter "@more/web" --frozen-lockfile
RUN pnpm --filter "@more/web" build

FROM ${NOPO_BASE_IMAGE} AS web

ARG SERVICE_NAME=web

COPY --from=web-build --chown=1001:1001 /app /app
COPY --from=web-build --chown=1001:1001 /home/nopoapp /home/nopoapp

ENV SERVICE_NAME=${SERVICE_NAME}
