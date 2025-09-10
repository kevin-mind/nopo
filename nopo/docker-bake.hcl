group "default" {
  targets = ["base"]
}

variable "DOCKER_TAG" {}
variable "DOCKER_TARGET" {}
variable "NODE_ENV" {}
variable "DOCKER_VERSION" {}
variable "DOCKER_BUILD" {}
variable "GIT_REPO" {}
variable "GIT_BRANCH" {}
variable "GIT_COMMIT" {}

target "base" {
  context    = "."
  dockerfile = "docker/Dockerfile"
  tags       = ["${DOCKER_TAG}"]
  target     = "${DOCKER_TARGET}"
  cache-from = ["type=gha"]
  cache-to   = ["type=gha,mode=max"]
  args = {
    NODE_ENV       = "${NODE_ENV}"
    DOCKER_TARGET  = "${DOCKER_TARGET}"
    DOCKER_TAG     = "${DOCKER_TAG}"
    DOCKER_VERSION = "${DOCKER_VERSION}"
    DOCKER_BUILD   = "${DOCKER_BUILD}"
    GIT_REPO       = "${GIT_REPO}"
    GIT_BRANCH     = "${GIT_BRANCH}"
    GIT_COMMIT     = "${GIT_COMMIT}"
  }
}
