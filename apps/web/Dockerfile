ARG NOPO_BASE_IMAGE=nopo:latest

FROM ${NOPO_BASE_IMAGE} AS web-build

USER root
WORKDIR /app
COPY --chown=nopoapp:nopoapp . .

USER nopoapp
RUN pnpm install --filter "@more/web" --frozen-lockfile
RUN pnpm --filter "@more/web" build

FROM ${NOPO_BASE_IMAGE} AS web

USER root
WORKDIR /app
COPY --from=web-build --chown=nopoapp:nopoapp /app /app
COPY --from=web-build --chown=nopoapp:nopoapp /home/nopoapp /home/nopoapp

USER nopoapp
ENV SERVICE_NAME=web
ENV SERVICE_COMMAND=start
CMD ["/cmd.sh"]
