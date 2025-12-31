FROM node:22-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY index.html .

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "npx --yes http-server -a 0.0.0.0 -p ${PORT:-8080} -c-1 --silent /app"]
