locals {
  fqdn = var.subdomain_prefix != "" ? "${var.subdomain_prefix}.${var.domain}" : var.domain
}

# Reserve a static IP for the load balancer
resource "google_compute_global_address" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-lb-ip"
}

# Serverless NEG for backend service
resource "google_compute_region_network_endpoint_group" "backend" {
  project               = var.project_id
  name                  = "${var.name_prefix}-backend-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = "${var.name_prefix}-backend"
  }
}

# Serverless NEG for web service
resource "google_compute_region_network_endpoint_group" "web" {
  project               = var.project_id
  name                  = "${var.name_prefix}-web-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = "${var.name_prefix}-web"
  }
}

# Backend service for backend NEG
resource "google_compute_backend_service" "backend" {
  project = var.project_id
  name    = "${var.name_prefix}-backend-service"

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.backend.id
  }
}

# Backend service for web NEG
resource "google_compute_backend_service" "web" {
  project = var.project_id
  name    = "${var.name_prefix}-web-service"

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.web.id
  }
}

# URL map for routing
resource "google_compute_url_map" "default" {
  project = var.project_id
  name    = "${var.name_prefix}-url-map"

  default_service = google_compute_backend_service.web.id

  host_rule {
    hosts        = [local.fqdn]
    path_matcher = "main"
  }

  path_matcher {
    name            = "main"
    default_service = google_compute_backend_service.web.id

    # Route /api, /admin, /django, /static to backend
    path_rule {
      paths   = ["/api", "/api/*"]
      service = google_compute_backend_service.backend.id
    }

    path_rule {
      paths   = ["/admin", "/admin/*"]
      service = google_compute_backend_service.backend.id
    }

    path_rule {
      paths   = ["/django", "/django/*"]
      service = google_compute_backend_service.backend.id
    }

    path_rule {
      paths   = ["/static", "/static/*"]
      service = google_compute_backend_service.backend.id
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
