ARG NOPO_BASE_IMAGE=nopo:latest

FROM ${NOPO_BASE_IMAGE} AS backend-build

USER root
WORKDIR /app
COPY --chown=nopoapp:nopoapp . .

USER nopoapp
RUN pnpm install --filter "@more/backend" --frozen-lockfile
WORKDIR /app/apps/backend
RUN uv sync --locked --no-install-workspace --frozen
WORKDIR /app
RUN pnpm --filter "@more/backend" build

FROM ${NOPO_BASE_IMAGE} AS backend

USER root
WORKDIR /app
COPY --from=backend-build --chown=nopoapp:nopoapp /app /app
COPY --from=backend-build --chown=nopoapp:nopoapp /home/nopoapp /home/nopoapp

USER nopoapp
ENV SERVICE_NAME=backend
ENV SERVICE_COMMAND=start
CMD ["/cmd.sh"]
