terraform {
  backend "gcs" {
    # bucket = var.terraform_state_bucket (set via -backend-config)
    # prefix = "nopo/prod/services"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

module "services" {
  source = "../../../layers/services"

  project_id       = var.project_id
  region           = var.region
  environment      = "prod"
  domain           = var.domain
  subdomain_prefix = "" # apex domain for prod

  terraform_state_bucket = var.terraform_state_bucket

  stable_backend_image = var.stable_backend_image
  stable_web_image     = var.stable_web_image
  canary_backend_image = var.canary_backend_image
  canary_web_image     = var.canary_web_image
}
