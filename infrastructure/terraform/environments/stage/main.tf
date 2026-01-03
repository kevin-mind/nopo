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

  # Dynamic services (preferred) or legacy individual images
  services      = var.services
  backend_image = var.backend_image
  web_image     = var.web_image

  database_url = var.database_url


  labels = {
    environment = "stage"
    project     = "nopo"
  }
}
