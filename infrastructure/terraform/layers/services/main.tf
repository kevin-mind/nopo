# =============================================================================
# SERVICES LAYER
# =============================================================================
#
# Resources that are deployed/updated with each release.
# This layer depends on the infra layer existing first.
#
# Resources:
# - Cloud Run services (stable + canary slots)
# - Migration jobs
# - NEGs (Network Endpoint Groups)
# - Backend services
# - URL Map (with header-based canary routing)
# - Target proxies and forwarding rules
#
# This layer is deployed during CI/CD on every release.
# =============================================================================

locals {
  name_prefix = "nopo-${var.environment}"

  # Base domain suffix for subdomains (e.g., "lenzhardt.org" or "staging.lenzhardt.org")
  domain_suffix = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain

  # For backwards compatibility, keep fqdn pointing to web subdomain
  fqdn       = "web.${local.domain_suffix}"
  public_url = "https://${local.fqdn}"

  common_labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "nopo"
    layer       = "services"
  }

  # Base service config
  base_config = {
    cpu           = "1"
    memory        = var.environment == "prod" ? "1Gi" : "512Mi"
    port          = 3000
    min_instances = 0
    max_instances = var.environment == "prod" ? 10 : 5
  }

  # Stable slot services - only include services with images provided
  stable_services = {
    for service, config in {
      backend = merge(local.base_config, {
        image          = var.stable_backend_image
        has_database   = true
        run_migrations = true
      })
      web = merge(local.base_config, {
        image  = var.stable_web_image
        memory = "256Mi"
      })
    } : service => config if config.image != null
  }

  # Canary slot services - only include services with images provided
  canary_services = {
    for service, config in {
      backend = merge(local.base_config, {
        image          = var.canary_backend_image
        has_database   = true
        run_migrations = false
      })
      web = merge(local.base_config, {
        image  = var.canary_web_image
        memory = "256Mi"
      })
    } : service => config if config.image != null
  }

  # Service routing
  default_service = "web"

  # Service keys (used for subdomain routing)
  service_keys = keys(local.stable_services)

  # Generate subdomain FQDNs for each service (e.g., "backend.lenzhardt.org", "web.lenzhardt.org")
  service_fqdns = { for key in local.service_keys : key => "${key}.${local.domain_suffix}" }

  # All FQDNs for SSL certificate
  all_fqdns = values(local.service_fqdns)
}

# =============================================================================
# DATA SOURCES - Reference infra layer outputs
# =============================================================================

data "terraform_remote_state" "infra" {
  backend = "gcs"
  config = {
    bucket = var.terraform_state_bucket
    prefix = "nopo/${var.environment}/infra"
  }
}

locals {
  # Pull values from infra layer
  service_account_email    = data.terraform_remote_state.infra.outputs.service_account_email
  django_secret_id         = data.terraform_remote_state.infra.outputs.django_secret_id
  database_url_secret_id   = data.terraform_remote_state.infra.outputs.database_url_secret_id
  static_backend_bucket_id = data.terraform_remote_state.infra.outputs.static_backend_bucket_id
  ssl_certificate_id       = data.terraform_remote_state.infra.outputs.ssl_certificate_id
  load_balancer_ip         = data.terraform_remote_state.infra.outputs.load_balancer_ip
}

# =============================================================================
# STABLE SLOT - Cloud Run Services
# =============================================================================

resource "google_cloud_run_v2_service" "stable" {
  for_each = local.stable_services

  project  = var.project_id
  name     = "${local.name_prefix}-${each.key}-stable"
  location = var.region

  template {
    service_account = local.service_account_email

    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      image = each.value.image

      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
        cpu_idle = true
      }

      ports {
        container_port = each.value.port
      }

      env {
        name  = "SERVICE_NAME"
        value = each.key
      }

      env {
        name  = "DEPLOYMENT_SLOT"
        value = "stable"
      }

      env {
        name  = "SITE_URL"
        value = local.public_url
      }

      env {
        name  = "STATIC_URL"
        value = "${local.public_url}/static/${each.key}/"
      }

      dynamic "env" {
        for_each = lookup(each.value, "has_database", false) ? [1] : []
        content {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = local.database_url_secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = lookup(each.value, "has_database", false) ? [1] : []
        content {
          name  = "DATABASE_SSL"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = lookup(each.value, "has_database", false) ? [1] : []
        content {
          name = "SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = local.django_secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/__version__"
          port = each.value.port
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/__version__"
          port = each.value.port
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }

  labels = merge(local.common_labels, { slot = "stable" })
}

resource "google_cloud_run_v2_service_iam_member" "stable_invokers" {
  for_each = local.stable_services

  project  = google_cloud_run_v2_service.stable[each.key].project
  location = google_cloud_run_v2_service.stable[each.key].location
  name     = google_cloud_run_v2_service.stable[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# =============================================================================
# CANARY SLOT - Cloud Run Services
# =============================================================================

resource "google_cloud_run_v2_service" "canary" {
  for_each = local.canary_services

  project  = var.project_id
  name     = "${local.name_prefix}-${each.key}-canary"
  location = var.region

  template {
    service_account = local.service_account_email

    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      image = each.value.image

      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
        cpu_idle = true
      }

      ports {
        container_port = each.value.port
      }

      env {
        name  = "SERVICE_NAME"
        value = each.key
      }

      env {
        name  = "DEPLOYMENT_SLOT"
        value = "canary"
      }

      env {
        name  = "SITE_URL"
        value = local.public_url
      }

      env {
        name  = "STATIC_URL"
        value = "${local.public_url}/static/${each.key}/"
      }

      dynamic "env" {
        for_each = lookup(each.value, "has_database", false) ? [1] : []
        content {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = local.database_url_secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = lookup(each.value, "has_database", false) ? [1] : []
        content {
          name  = "DATABASE_SSL"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = lookup(each.value, "has_database", false) ? [1] : []
        content {
          name = "SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = local.django_secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/__version__"
          port = each.value.port
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/__version__"
          port = each.value.port
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }

  labels = merge(local.common_labels, { slot = "canary" })
}

resource "google_cloud_run_v2_service_iam_member" "canary_invokers" {
  for_each = local.canary_services

  project  = google_cloud_run_v2_service.canary[each.key].project
  location = google_cloud_run_v2_service.canary[each.key].location
  name     = google_cloud_run_v2_service.canary[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# =============================================================================
# MIGRATION JOBS (stable slot only)
# =============================================================================

resource "google_cloud_run_v2_job" "migration_check" {
  for_each = { for k, v in local.stable_services : k => v if lookup(v, "run_migrations", false) }

  project  = var.project_id
  name     = "${local.name_prefix}-${each.key}-migrate-check"
  location = var.region

  template {
    template {
      service_account = local.service_account_email

      containers {
        image = each.value.image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        command = ["nopo", "migrate:check", each.key]

        env {
          name  = "SERVICE_NAME"
          value = each.key
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = local.database_url_secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "DATABASE_SSL"
          value = "true"
        }

        env {
          name = "SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = local.django_secret_id
              version = "latest"
            }
          }
        }
      }

      max_retries = 0
      timeout     = "120s"
    }
  }

  labels = local.common_labels
}

resource "google_cloud_run_v2_job" "migrations" {
  for_each = { for k, v in local.stable_services : k => v if lookup(v, "run_migrations", false) }

  project  = var.project_id
  name     = "${local.name_prefix}-${each.key}-migrate"
  location = var.region

  template {
    template {
      service_account = local.service_account_email

      containers {
        image = each.value.image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        command = ["nopo", "migrate:run", each.key]

        env {
          name  = "SERVICE_NAME"
          value = each.key
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = local.database_url_secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "DATABASE_SSL"
          value = "true"
        }

        env {
          name = "SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = local.django_secret_id
              version = "latest"
            }
          }
        }
      }

      max_retries = 1
      timeout     = "600s"
    }
  }

  labels = local.common_labels
}

# =============================================================================
# NETWORK ENDPOINT GROUPS (NEGs)
# =============================================================================

resource "google_compute_region_network_endpoint_group" "stable" {
  for_each = local.stable_services

  project               = var.project_id
  name                  = "${local.name_prefix}-${each.key}-stable-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.stable[each.key].name
  }
}

resource "google_compute_region_network_endpoint_group" "canary" {
  for_each = local.canary_services

  project               = var.project_id
  name                  = "${local.name_prefix}-${each.key}-canary-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.canary[each.key].name
  }
}

# =============================================================================
# BACKEND SERVICES
# =============================================================================

resource "google_compute_backend_service" "stable" {
  for_each = local.stable_services

  project = var.project_id
  name    = "${local.name_prefix}-${each.key}-stable-backend"

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.stable[each.key].id
  }
}

resource "google_compute_backend_service" "canary" {
  for_each = local.canary_services

  project = var.project_id
  name    = "${local.name_prefix}-${each.key}-canary-backend"

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.canary[each.key].id
  }
}

# =============================================================================
# URL MAP with Host-Based and Header-Based Routing
# =============================================================================

# URL map for subdomain-based routing with header-based canary support
#
# Routing logic:
# 1. Each service gets its own subdomain (e.g., backend.domain.com, web.domain.com)
# 2. If X-Force-Canary: true header is present -> route to canary backend for that service
# 3. Otherwise -> route to stable backend for that service
#
# Static files are served from a shared bucket at any subdomain's /static/ path
# X-Traffic-Source: public header is injected to all public traffic

resource "google_compute_url_map" "default" {
  project = var.project_id
  name    = "${local.name_prefix}-url-map"

  # Default to stable default service (for unmatched hosts)
  default_service = google_compute_backend_service.stable[local.default_service].id

  # Create a host rule for each service subdomain
  dynamic "host_rule" {
    for_each = local.service_fqdns
    content {
      hosts        = [host_rule.value]
      path_matcher = host_rule.key
    }
  }

  # Create a path matcher for each service with canary header support
  dynamic "path_matcher" {
    for_each = local.service_keys
    content {
      name            = path_matcher.value
      default_service = google_compute_backend_service.stable[path_matcher.value].id

      # Canary route: If X-Force-Canary header is present, route to canary backend
      route_rules {
        priority = 1
        match_rules {
          prefix_match = "/"
          header_matches {
            header_name = "X-Force-Canary"
            exact_match = "true"
          }
        }
        route_action {
          weighted_backend_services {
            backend_service = google_compute_backend_service.canary[path_matcher.value].id
            weight          = 100
            header_action {
              request_headers_to_add {
                header_name  = "X-Traffic-Source"
                header_value = "public"
                replace      = true
              }
            }
          }
        }
      }

      # Static files route (shared bucket, no canary)
      route_rules {
        priority = 2
        match_rules {
          prefix_match = "/static/"
        }
        route_action {
          url_rewrite {
            path_prefix_rewrite = "/"
          }
        }
        service = local.static_backend_bucket_id
      }

      # Stable route: Default route to stable backend with X-Traffic-Source header
      route_rules {
        priority = 10
        match_rules {
          prefix_match = "/"
        }
        route_action {
          weighted_backend_services {
            backend_service = google_compute_backend_service.stable[path_matcher.value].id
            weight          = 100
            header_action {
              request_headers_to_add {
                header_name  = "X-Traffic-Source"
                header_value = "public"
                replace      = true
              }
            }
          }
        }
      }
    }
  }
}

# =============================================================================
# TARGET PROXIES AND FORWARDING RULES
# =============================================================================

resource "google_compute_target_https_proxy" "default" {
  project = var.project_id
  name    = "${local.name_prefix}-https-proxy"

  url_map          = google_compute_url_map.default.id
  ssl_certificates = [local.ssl_certificate_id]
}

resource "google_compute_url_map" "http_redirect" {
  project = var.project_id
  name    = "${local.name_prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  project = var.project_id
  name    = "${local.name_prefix}-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "https" {
  project = var.project_id
  name    = "${local.name_prefix}-https-rule"

  ip_address            = local.load_balancer_ip
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL"
  port_range            = "443"
  target                = google_compute_target_https_proxy.default.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project = var.project_id
  name    = "${local.name_prefix}-http-rule"

  ip_address            = local.load_balancer_ip
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect.id
}
