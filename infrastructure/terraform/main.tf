locals {
  name_prefix = "nopo-${var.environment}"
  fqdn        = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain

  common_labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
    project     = "nopo"
  })

  # Build services map - either from var.services or legacy individual variables
  services = length(var.services) > 0 ? var.services : {
    backend = {
      image          = var.backend_image
      cpu            = "1"
      memory         = "512Mi"
      port           = 3000
      min_instances  = var.environment == "prod" ? 1 : 0
      max_instances  = var.environment == "prod" ? 10 : 5
      has_database   = true
      run_migrations = true
    }
    web = {
      image          = var.web_image
      cpu            = "1"
      memory         = "256Mi"
      port           = 3000
      min_instances  = var.environment == "prod" ? 1 : 0
      max_instances  = var.environment == "prod" ? 10 : 5
      has_database   = false
      run_migrations = false
    }
  }

  # Default service for load balancer (first non-db service, or first service)
  non_db_services = [for k, v in local.services : k if !v.has_database]
  default_service = length(local.non_db_services) > 0 ? local.non_db_services[0] : (contains(keys(local.services), "web") ? "web" : keys(local.services)[0])
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

# Artifact Registry for container images
module "artifact_registry" {
  source = "./modules/artifact-registry"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  depends_on = [google_project_service.services]
}

# Secrets management
module "secrets" {
  source = "./modules/secrets"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  supabase_database_url = var.supabase_database_url

  depends_on = [google_project_service.services]
}

# Cloud Run services (dynamic)
module "cloudrun" {
  source = "./modules/cloudrun"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  services = local.services

  django_secret_key_id            = module.secrets.django_secret_key_id
  supabase_database_url_secret_id = module.secrets.supabase_database_url_secret_id

  public_url      = "https://${local.fqdn}"
  static_url_base = var.enable_static_bucket ? "https://${local.fqdn}/static" : ""

  depends_on = [
    google_project_service.services,
    module.secrets,
  ]
}

# Static assets bucket (for serving CSS/JS via CDN)
module "static_assets" {
  source = "./modules/static-assets"
  count  = var.enable_static_bucket ? 1 : 0

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  cors_origins = ["https://${local.fqdn}"]
  enable_cdn   = var.environment == "prod"

  depends_on = [google_project_service.services]
}

# Load Balancer with SSL
module "loadbalancer" {
  source = "./modules/loadbalancer"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  domain           = var.domain
  subdomain_prefix = var.subdomain_prefix

  # Pass all service URLs for dynamic routing
  services        = module.cloudrun.service_urls
  default_service = local.default_service

  # Only route db services to backend if needed, but really standard routing is fine
  # Keeping generic map logic
  db_services = [for k, v in local.services : k if v.has_database]

  # Route /static/* to bucket if enabled
  static_backend_bucket_id = var.enable_static_bucket ? module.static_assets[0].backend_bucket_id : null

  depends_on = [
    google_project_service.services,
    module.cloudrun,
    module.static_assets,
  ]
}
