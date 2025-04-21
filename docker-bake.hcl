variable "DOCKER_REGISTRY" {
  default = ""
}

variable "DOCKER_IMAGE" {
  default = "kevin-mind/nopo"
}

variable "DOCKER_VERSION" {
  default = "local"
}

variable "DOCKER_TARGET" {
  default = "development"
}

variable "NODE_ENV" {
  default = "development"
}

function "to_tag" {
  params = []
  result = join("", [
    DOCKER_REGISTRY,
    DOCKER_REGISTRY != "" ? "/" : "",
    DOCKER_IMAGE,
    ":",
    # Generate a random string of 5 characters to suffix the version
    # Which is a short sha of the git commit. This virtually guarnatees
    # that a tag is unique per build but still identifiable.
    "${DOCKER_VERSION}-${substr(uuidv4(), 0, 5)}"
  ])
}

variable "DOCKER_TAG" {
  default = to_tag()
}

group "default" {
  targets = ["base"]
}

target "docker-metadata-action" {}

target "base" {
  inherits = ["docker-metadata-action"]
  tags = [
    "${DOCKER_TAG}"
  ]
  args = {
    NODE_ENV = "${NODE_ENV}"
  }
  context = "."
  dockerfile = "Dockerfile"
  target = "${DOCKER_TARGET}"
  cache-from = ["type=gha"]
  cache-to = ["type=gha,mode=max"]
}
