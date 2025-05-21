target "base" {
  tags = ["${DOCKER_TAG}"]
  target = "${DOCKER_TARGET}"
  args = {
    NODE_ENV = "${NODE_ENV}"
    DOCKER_TAG = "${DOCKER_TAG}"
    DOCKER_VERSION = "${DOCKER_VERSION}"
    DOCKER_TARGET = "${DOCKER_TARGET}"
  }
  cache-from = ["type=gha"]
  cache-to = ["type=gha,mode=max"]
  pull = true
  output = ["type=docker"]
}
