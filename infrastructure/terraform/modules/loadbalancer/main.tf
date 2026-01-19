locals {
  # Base domain suffix for subdomains (e.g., "lenzhardt.org" or "staging.lenzhardt.org")
  domain_suffix = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain

  # All service keys (stable and canary should have the same keys)
  service_keys = keys(var.stable_services)

  # Generate subdomain FQDNs for each service (e.g., "api.lenzhardt.org", "web.lenzhardt.org")
  service_fqdns = { for key in local.service_keys : key => "${key}.${local.domain_suffix}" }

  # All FQDNs for SSL certificate (list of all service subdomains)
  all_fqdns = values(local.service_fqdns)
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
# URL MAP with Host-Based and Header-Based Routing
# ============================================================================

# URL map for subdomain-based routing with header-based canary support
#
# Routing logic:
# 1. Each service gets its own subdomain (e.g., api.domain.com, web.domain.com)
# 2. If X-Force-Canary: true header is present -> route to canary backend for that service
# 3. Otherwise -> route to stable backend for that service
#
# Static files are served from a shared bucket at any subdomain's /static/ path

resource "google_compute_url_map" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-url-map"

  # Default to stable default service (for unmatched hosts)
  default_service = google_compute_backend_service.stable[var.default_service].id

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
            header_name = var.canary_header_name
            exact_match = var.canary_header_value
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
      dynamic "route_rules" {
        for_each = var.static_backend_bucket_id != null ? [1] : []
        content {
          priority = 2
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

# Managed SSL certificate for all service subdomains
# Note: For wildcard certificates, use google_certificate_manager_certificate with DNS authorization
# For now, we list all service subdomains explicitly (supports up to 100 domains)
resource "google_compute_managed_ssl_certificate" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-ssl-cert"

  managed {
    domains = local.all_fqdns
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
