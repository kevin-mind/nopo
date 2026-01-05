terraform {
  backend "gcs" {
    # bucket = var.terraform_state_bucket (set via -backend-config)
    # prefix = "nopo/prod/infra"
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

module "infra" {
  source = "../../../layers/infra"

  project_id       = var.project_id
  region           = var.region
  environment      = "prod"
  domain           = var.domain
  subdomain_prefix = "" # apex domain for prod

  supabase_database_url = var.supabase_database_url
}

# =============================================================================
# IMPORTS (Adopt existing resources if they exist)
# =============================================================================

import {
  to = module.infra.google_artifact_registry_repository.main
  id = "projects/nopo-gcp/locations/us-central1/repositories/nopo-prod-repo"
}

import {
  to = module.infra.google_storage_bucket.static
  id = "nopo-prod-static"
}

import {
  to = module.infra.google_compute_backend_bucket.static
  id = "nopo-prod-static-backend"
}

import {
  to = module.infra.google_service_account.cloudrun
  id = "projects/nopo-gcp/serviceAccounts/nopo-prod-cloudrun@nopo-gcp.iam.gserviceaccount.com"
}
