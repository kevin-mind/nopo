locals {
  name_prefix = "nopo-${var.environment}"
  fqdn        = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain

  common_labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
    project     = "nopo"
  })
}

# Enable required APIs
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "compute.googleapis.com",
    "vpcaccess.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "servicenetworking.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Networking module - VPC and private connectivity
module "networking" {
  source = "./modules/networking"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  depends_on = [google_project_service.services]
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

  depends_on = [google_project_service.services]
}

# Cloud SQL (PostgreSQL) database
module "cloudsql" {
  source = "./modules/cloudsql"

  project_id         = var.project_id
  region             = var.region
  name_prefix        = local.name_prefix
  labels             = local.common_labels
  tier               = var.db_tier
  database_name      = var.db_name
  database_user      = var.db_user
  vpc_network_id     = module.networking.vpc_network_id
  private_ip_address = module.networking.private_ip_address

  db_password_secret_id = module.secrets.db_password_secret_id

  depends_on = [
    google_project_service.services,
    module.networking,
    module.secrets,
  ]
}

# Cloud Run services
module "cloudrun" {
  source = "./modules/cloudrun"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  backend_image  = var.backend_image
  web_image      = var.web_image
  backend_cpu    = var.backend_cpu
  backend_memory = var.backend_memory
  web_cpu        = var.web_cpu
  web_memory     = var.web_memory
  min_instances  = var.min_instances
  max_instances  = var.max_instances

  vpc_connector_id      = module.networking.vpc_connector_id
  db_connection_name    = module.cloudsql.connection_name
  db_host               = module.cloudsql.private_ip
  db_name               = var.db_name
  db_user               = var.db_user
  db_password_secret_id = module.secrets.db_password_secret_id
  django_secret_key_id  = module.secrets.django_secret_key_id

  public_url = "https://${local.fqdn}"

  depends_on = [
    google_project_service.services,
    module.networking,
    module.cloudsql,
    module.secrets,
  ]
}

# Load Balancer with SSL
module "loadbalancer" {
  source = "./modules/loadbalancer"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.common_labels

  domain              = var.domain
  subdomain_prefix    = var.subdomain_prefix
  backend_service_url = module.cloudrun.backend_service_url
  web_service_url     = module.cloudrun.web_service_url

  # name_prefix is already passed above and will be used to reference Cloud Run services

  depends_on = [
    google_project_service.services,
    module.cloudrun,
  ]
}
