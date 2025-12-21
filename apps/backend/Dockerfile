ARG NOPO_BASE_IMAGE=nopo:latest

FROM ${NOPO_BASE_IMAGE} AS backend-build

# User and workdir are inherited from base image (nopoapp, /app)
# Use numeric UID:GID for COPY --chown (matches NOPO_APP_UID:NOPO_APP_GID from base)
COPY --chown=1001:1001 . .

RUN pnpm install --filter "@more/backend" --frozen-lockfile
RUN pnpm --filter "@more/backend" build

FROM ${NOPO_BASE_IMAGE} AS backend

ARG SERVICE_NAME=backend

COPY --from=backend-build --chown=1001:1001 /app /app
COPY --from=backend-build --chown=1001:1001 /home/nopoapp /home/nopoapp

ENV SERVICE_NAME=${SERVICE_NAME}
