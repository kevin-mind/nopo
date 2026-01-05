locals {
  fqdn = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain

  # All service keys (stable and canary should have the same keys)
  service_keys = keys(var.stable_services)
}

# Reserve a static IP for the load balancer
resource "google_compute_global_address" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-lb-ip"
}

# ============================================================================
# STABLE SLOT - NEGs and Backend Services
# ============================================================================

# Serverless NEGs for stable services
resource "google_compute_region_network_endpoint_group" "stable" {
  for_each = var.stable_services

  project               = var.project_id
  name                  = "${var.name_prefix}-${each.key}-stable-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = each.value
  }
}

# Backend services for stable NEGs
resource "google_compute_backend_service" "stable" {
  for_each = var.stable_services

  project = var.project_id
  name    = "${var.name_prefix}-${each.key}-stable-backend"

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.stable[each.key].id
  }
}

# ============================================================================
# CANARY SLOT - NEGs and Backend Services
# ============================================================================

# Serverless NEGs for canary services
resource "google_compute_region_network_endpoint_group" "canary" {
  for_each = var.canary_services

  project               = var.project_id
  name                  = "${var.name_prefix}-${each.key}-canary-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = each.value
  }
}

# Backend services for canary NEGs
resource "google_compute_backend_service" "canary" {
  for_each = var.canary_services

  project = var.project_id
  name    = "${var.name_prefix}-${each.key}-canary-backend"

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.canary[each.key].id
  }
}

# ============================================================================
# URL MAP with Header-Based Routing
# ============================================================================

# URL map for routing with header-based canary support
#
# Routing logic:
# 1. If X-Force-Canary: true header is present -> route to canary backends
# 2. Otherwise -> route to stable backends
#
# Path routing within each slot:
# - /static/* -> Static bucket (shared between slots)
# - /api/*, /admin/*, /django/* -> DB services (backend)
# - /* -> Default service (web)

resource "google_compute_url_map" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-url-map"

  # Default to stable default service
  default_service = google_compute_backend_service.stable[var.default_service].id

  host_rule {
    hosts        = [local.fqdn]
    path_matcher = "main"
  }

  path_matcher {
    name            = "main"
    default_service = google_compute_backend_service.stable[var.default_service].id

    # ========================================================================
    # CANARY ROUTES (Higher Priority - Check header first)
    # ========================================================================

    # Canary: Static files (shared bucket, no slot-specific routing needed)
    # Static assets are hashed, so both slots can use the same bucket

    # Canary: API routes
    dynamic "route_rules" {
      for_each = length(var.db_services) > 0 ? [1] : []
      content {
        priority = 1
        match_rules {
          prefix_match = "/api/"
          header_matches {
            header_name = var.canary_header_name
            exact_match = var.canary_header_value
          }
        }
        match_rules {
          prefix_match = "/api"
          header_matches {
            header_name = var.canary_header_name
            exact_match = var.canary_header_value
          }
        }
        service = google_compute_backend_service.canary[var.db_services[0]].id
      }
    }

    # Canary: Admin routes
    dynamic "route_rules" {
      for_each = length(var.db_services) > 0 ? [1] : []
      content {
        priority = 2
        match_rules {
          prefix_match = "/admin/"
          header_matches {
            header_name = var.canary_header_name
            exact_match = var.canary_header_value
          }
        }
        match_rules {
          prefix_match = "/admin"
          header_matches {
            header_name = var.canary_header_name
            exact_match = var.canary_header_value
          }
        }
        service = google_compute_backend_service.canary[var.db_services[0]].id
      }
    }

    # Canary: Django routes
    dynamic "route_rules" {
      for_each = length(var.db_services) > 0 ? [1] : []
      content {
        priority = 3
        match_rules {
          prefix_match = "/django/"
          header_matches {
            header_name = var.canary_header_name
            exact_match = var.canary_header_value
          }
        }
        match_rules {
          prefix_match = "/django"
          header_matches {
            header_name = var.canary_header_name
            exact_match = var.canary_header_value
          }
        }
        service = google_compute_backend_service.canary[var.db_services[0]].id
      }
    }

    # Canary: Default route (web) - catches all canary requests not matched above
    route_rules {
      priority = 4
      match_rules {
        prefix_match = "/"
        header_matches {
          header_name = var.canary_header_name
          exact_match = var.canary_header_value
        }
      }
      service = google_compute_backend_service.canary[var.default_service].id
    }

    # ========================================================================
    # STABLE ROUTES (Lower Priority - Default when no canary header)
    # ========================================================================

    # Stable: Static files to bucket (shared between slots)
    dynamic "route_rules" {
      for_each = var.static_backend_bucket_id != null ? [1] : []
      content {
        priority = 10
        match_rules {
          prefix_match = "/static/"
        }
        route_action {
          url_rewrite {
            path_prefix_rewrite = "/"
          }
        }
        service = var.static_backend_bucket_id
      }
    }

    # Stable: API routes
    dynamic "route_rules" {
      for_each = length(var.db_services) > 0 ? [1] : []
      content {
        priority = 11
        match_rules {
          prefix_match = "/api/"
        }
        match_rules {
          prefix_match = "/api"
        }
        service = google_compute_backend_service.stable[var.db_services[0]].id
      }
    }

    # Stable: Admin routes
    dynamic "route_rules" {
      for_each = length(var.db_services) > 0 ? [1] : []
      content {
        priority = 12
        match_rules {
          prefix_match = "/admin/"
        }
        match_rules {
          prefix_match = "/admin"
        }
        service = google_compute_backend_service.stable[var.db_services[0]].id
      }
    }

    # Stable: Django routes
    dynamic "route_rules" {
      for_each = length(var.db_services) > 0 ? [1] : []
      content {
        priority = 13
        match_rules {
          prefix_match = "/django/"
        }
        match_rules {
          prefix_match = "/django"
        }
        service = google_compute_backend_service.stable[var.db_services[0]].id
      }
    }

    # Note: Stable default (/*) is handled by default_service above
  }
}

# Managed SSL certificate
resource "google_compute_managed_ssl_certificate" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-ssl-cert"

  managed {
    domains = [local.fqdn]
  }
}

# HTTPS target proxy
resource "google_compute_target_https_proxy" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-https-proxy"

  url_map          = google_compute_url_map.default.id
  ssl_certificates = [google_compute_managed_ssl_certificate.default.id]
}

# HTTP to HTTPS redirect URL map
resource "google_compute_url_map" "http_redirect" {
  project = var.project_id
  name    = "${var.name_prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

# HTTP target proxy for redirect
resource "google_compute_target_http_proxy" "http_redirect" {
  project = var.project_id
  name    = "${var.name_prefix}-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

# HTTPS forwarding rule
resource "google_compute_global_forwarding_rule" "https" {
  project = var.project_id
  name    = "${var.name_prefix}-https-rule"

  ip_address            = google_compute_global_address.default.address
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL"
  port_range            = "443"
  target                = google_compute_target_https_proxy.default.id
}

# HTTP forwarding rule (for redirect)
resource "google_compute_global_forwarding_rule" "http" {
  project = var.project_id
  name    = "${var.name_prefix}-http-rule"

  ip_address            = google_compute_global_address.default.address
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect.id
}
