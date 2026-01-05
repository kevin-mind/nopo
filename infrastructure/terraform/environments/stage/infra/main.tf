terraform {
  backend "gcs" {
    # bucket = var.terraform_state_bucket (set via -backend-config)
    # prefix = "nopo/stage/infra"
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
  environment      = "stage"
  domain           = var.domain
  subdomain_prefix = "stage"

  supabase_database_url = var.supabase_database_url
}

# =============================================================================
# IMPORTS (Adopt existing resources if they exist)
# =============================================================================

import {
  to = module.infra.google_artifact_registry_repository.main
  id = "projects/nopo-gcp/locations/us-central1/repositories/nopo-stage-repo"
}

import {
  to = module.infra.google_storage_bucket.static
  id = "nopo-stage-static"
}

import {
  to = module.infra.google_compute_backend_bucket.static
  id = "nopo-stage-static-backend"
}

import {
  to = module.infra.google_service_account.cloudrun
  id = "projects/nopo-gcp/serviceAccounts/nopo-stage-cloudrun@nopo-gcp.iam.gserviceaccount.com"
}
