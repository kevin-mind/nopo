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

# Define the targets to build.
# Each should correspond to:
# 1) a service in the docker-compose.yml file
# 2) a directory in the apps/ directory of the same name
function "get_targets" {
  params = []
  result = ["web", "backend"]
}

group "default" {
  targets = get_targets()
}

target "docker-metadata-action" {}

target "default" {
  inherits = ["docker-metadata-action"]
  name = "${tgt}"
  matrix = {
    tgt = get_targets()
  }
  tags = [
    "${DOCKER_REGISTRY}${DOCKER_REGISTRY != "" ? "/" : ""}${DOCKER_IMAGE}-${tgt}:${DOCKER_VERSION}"
  ]
  args = {
    NODE_ENV = "${NODE_ENV}"
    APP_NAME = "@more/${tgt}"
  }
  context = "."
  dockerfile = "Dockerfile"
  target = "${DOCKER_TARGET}"
  cache-from = ["type=gha"]
  cache-to = ["type=gha,mode=max"]
}
