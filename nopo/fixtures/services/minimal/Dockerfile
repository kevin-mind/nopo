FROM alpine:3.19

RUN apk add --no-cache bash

WORKDIR /app

# Simple marker file to verify build
RUN echo "FIXTURE_MINIMAL_BUILD_SUCCESS" > /app/build-marker.txt

CMD ["cat", "/app/build-marker.txt"]
