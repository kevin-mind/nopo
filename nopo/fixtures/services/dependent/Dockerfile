FROM alpine:3.19

RUN apk add --no-cache bash

WORKDIR /app

# Simple marker file to verify build
RUN echo "FIXTURE_DEPENDENT_BUILD_SUCCESS" > /app/build-marker.txt

CMD ["cat", "/app/build-marker.txt"]
