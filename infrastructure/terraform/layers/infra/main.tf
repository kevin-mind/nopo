# =============================================================================
# INFRASTRUCTURE LAYER
# =============================================================================
#
# Long-lived resources that must exist before deployments can happen.
# These are created once and rarely change.
#
# Resources:
# - Artifact Registry (for Docker images)
# - GCS Bucket + Backend Bucket (for static assets)
# - Service Account (for Cloud Run services)
# - Secrets (Django key, Database URL)
# - Load Balancer IP (static, for DNS)
# - SSL Certificate (managed, for HTTPS)
#
# This layer is deployed manually or via a separate workflow, NOT during
# regular deployments. The services layer depends on outputs from this layer.
# =============================================================================

locals {
  name_prefix = "nopo-${var.environment}"
  fqdn        = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain

  common_labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "nopo"
    layer       = "infra"
  }
}

# Enable required APIs
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "compute.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# =============================================================================
# ARTIFACT REGISTRY
# =============================================================================

resource "google_artifact_registry_repository" "main" {
  project       = var.project_id
  location      = var.region
  repository_id = "${local.name_prefix}-repo"
  format        = "DOCKER"
  description   = "Docker images for nopo ${var.environment} environment"

  labels = local.common_labels

  depends_on = [google_project_service.services]
}

# =============================================================================
# SERVICE ACCOUNT
# =============================================================================

resource "google_service_account" "cloudrun" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-cloudrun"
  display_name = "${local.name_prefix} Cloud Run Service Account"

  depends_on = [google_project_service.services]
}

# =============================================================================
# SECRETS
# =============================================================================

resource "random_password" "django_secret" {
  length  = 50
  special = true
}

resource "google_secret_manager_secret" "django_secret" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-django-secret"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "django_secret" {
  secret      = google_secret_manager_secret.django_secret.id
  secret_data = random_password.django_secret.result
}

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-database-url"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = var.supabase_database_url
}

# Grant service account access to secrets
resource "google_secret_manager_secret_iam_member" "django_secret_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.django_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "database_url_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

# =============================================================================
# STATIC ASSETS BUCKET
# =============================================================================

resource "google_storage_bucket" "static" {
  project  = var.project_id
  name     = "${local.name_prefix}-static"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  cors {
    origin          = ["https://${local.fqdn}"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Cache-Control"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  labels = local.common_labels

  depends_on = [google_project_service.services]
}

resource "google_storage_bucket_iam_member" "static_public_read" {
  bucket = google_storage_bucket.static.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Backend bucket for load balancer
resource "google_compute_backend_bucket" "static" {
  project     = var.project_id
  name        = "${local.name_prefix}-static-backend"
  bucket_name = google_storage_bucket.static.name
  enable_cdn  = var.environment == "prod"

  depends_on = [google_project_service.services]
}

# =============================================================================
# LOAD BALANCER IP & SSL
# =============================================================================

resource "google_compute_global_address" "default" {
  project = var.project_id
  name    = "${local.name_prefix}-lb-ip"

  depends_on = [google_project_service.services]
}

resource "google_compute_managed_ssl_certificate" "default" {
  project = var.project_id
  name    = "${local.name_prefix}-ssl-cert"

  managed {
    domains = [local.fqdn]
  }

  depends_on = [google_project_service.services]
}
