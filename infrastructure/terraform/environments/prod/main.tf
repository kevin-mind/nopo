terraform {
  backend "gcs" {
    # Configure in backend.hcl or via -backend-config
    # bucket = "your-terraform-state-bucket"
    # prefix = "nopo/prod"
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

  project_id            = var.project_id
  region                = var.region
  environment           = "prod"
  domain                = var.domain
  subdomain_prefix      = var.subdomain_prefix
  supabase_database_url = var.supabase_database_url
  # Dynamic services (preferred) or legacy individual images
  services      = var.services
  backend_image = var.backend_image
  web_image     = var.web_image

  # Production uses larger resources
  db_tier = "db-custom-1-3840" # 1 vCPU, 3.75 GB RAM

  labels = {
    environment = "prod"
    project     = "nopo"
  }
}
