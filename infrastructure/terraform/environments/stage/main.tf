terraform {
  backend "gcs" {
    # Configure in backend.hcl or via -backend-config
    # bucket = "your-terraform-state-bucket"
    # prefix = "nopo/stage"
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

module "infrastructure" {
  source = "../../"

  project_id       = var.project_id
  region           = var.region
  environment      = "stage"
  domain           = var.domain
  subdomain_prefix = var.subdomain_prefix

  backend_image = var.backend_image
  web_image     = var.web_image

  # Use smaller resources for staging
  db_tier        = "db-f1-micro"
  backend_cpu    = "1"
  backend_memory = "512Mi"
  web_cpu        = "1"
  web_memory     = "256Mi"
  min_instances  = 0
  max_instances  = 5

  labels = {
    environment = "stage"
    project     = "nopo"
  }
}
