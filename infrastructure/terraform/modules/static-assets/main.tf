# Cloud Storage bucket for static assets
# Structure: gs://bucket-name/<service>/<files...>
# Access: /static/<service>/<path> via Load Balancer
resource "google_storage_bucket" "static" {
  project  = var.project_id
  name     = "${var.name_prefix}-static"
  location = var.region

  # Enable uniform bucket-level access (recommended)
  uniform_bucket_level_access = true

  # CORS configuration for web assets
  cors {
    origin          = var.cors_origins
    method          = ["GET", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "Cache-Control", "Content-Encoding", "ETag"]
    max_age_seconds = 3600
  }

  # Versioning for rollback capability
  versioning {
    enabled = true
  }

  # Lifecycle rules to clean up old versions
  lifecycle_rule {
    condition {
      num_newer_versions = 3
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = var.labels
}

# Make the bucket publicly readable
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.static.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Backend bucket for load balancer integration
resource "google_compute_backend_bucket" "static" {
  project     = var.project_id
  name        = "${var.name_prefix}-static-backend"
  description = "Backend bucket for static assets"
  bucket_name = google_storage_bucket.static.name
  enable_cdn  = var.enable_cdn

  dynamic "cdn_policy" {
    for_each = var.enable_cdn ? [1] : []
    content {
      cache_mode        = "CACHE_ALL_STATIC"
      default_ttl       = 3600  # 1 hour
      max_ttl           = 86400 # 24 hours
      client_ttl        = 3600  # 1 hour
      negative_caching  = true
      serve_while_stale = 86400 # Serve stale content for up to 24 hours
    }
  }
}
