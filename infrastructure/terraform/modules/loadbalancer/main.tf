locals {
  fqdn = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain
}

# Reserve a static IP for the load balancer
resource "google_compute_global_address" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-lb-ip"
}

# Serverless NEGs for each service
resource "google_compute_region_network_endpoint_group" "services" {
  for_each = var.services

  project               = var.project_id
  name                  = "${var.name_prefix}-${each.key}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = "${var.name_prefix}-${each.key}"
  }
}

# Backend services for each NEG
resource "google_compute_backend_service" "services" {
  for_each = var.services

  project = var.project_id
  name    = "${var.name_prefix}-${each.key}-backend"

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.services[each.key].id
  }
}

# URL map for routing
resource "google_compute_url_map" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-url-map"

  # Default to the specified default service (usually "web")
  default_service = google_compute_backend_service.services[var.default_service].id

  host_rule {
    hosts        = [local.fqdn]
    path_matcher = "main"
  }

  path_matcher {
    name            = "main"
    default_service = google_compute_backend_service.services[var.default_service].id

    # Route API paths to database-connected services (typically "backend")
    dynamic "path_rule" {
      for_each = var.db_services
      content {
        paths   = ["/api", "/api/*"]
        service = google_compute_backend_service.services[path_rule.value].id
      }
    }

    dynamic "path_rule" {
      for_each = var.db_services
      content {
        paths   = ["/admin", "/admin/*"]
        service = google_compute_backend_service.services[path_rule.value].id
      }
    }

    dynamic "path_rule" {
      for_each = var.db_services
      content {
        paths   = ["/django", "/django/*"]
        service = google_compute_backend_service.services[path_rule.value].id
      }
    }

    # Route static files to bucket backend if configured, otherwise to db_services
    dynamic "path_rule" {
      for_each = var.static_backend_bucket_id != null ? [1] : []
      content {
        paths   = ["/static", "/static/*"]
        service = var.static_backend_bucket_id
      }
    }

    # Fallback: route static to db_services if no bucket configured
    dynamic "path_rule" {
      for_each = var.static_backend_bucket_id == null ? var.db_services : []
      content {
        paths   = ["/static", "/static/*"]
        service = google_compute_backend_service.services[path_rule.value].id
      }
    }
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
