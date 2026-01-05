# Cloud Run services for a deployment slot (stable or canary)
#
# This module creates Cloud Run services with a slot suffix in the name.
# Example: nopo-stage-backend-stable, nopo-stage-backend-canary
#
# The stable slot receives normal traffic.
# The canary slot receives traffic only when X-Force-Canary header is present.

locals {
  # Service names include the slot suffix
  # e.g., nopo-stage-backend-stable, nopo-stage-web-canary
  slot_suffix = "-${var.slot}"
}

# Dynamic Cloud Run services based on var.services
resource "google_cloud_run_v2_service" "services" {
  for_each = var.services

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}${local.slot_suffix}"
  location = var.region

  template {
    service_account = var.service_account_email

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

      # Common environment variables
      env {
        name  = "SERVICE_NAME"
        value = each.key
      }

      env {
        name  = "DEPLOYMENT_SLOT"
        value = var.slot
      }

      env {
        name  = "SITE_URL"
        value = var.public_url
      }

      # Static files URL (only if static bucket is configured)
      dynamic "env" {
        for_each = var.static_url_base != "" ? [1] : []
        content {
          name  = "STATIC_URL"
          value = "${var.static_url_base}/${each.key}/"
        }
      }

      # Database environment variables (Supabase)
      dynamic "env" {
        for_each = each.value.has_database && var.supabase_database_url_secret_id != "" ? [1] : []
        content {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.supabase_database_url_secret_id
              version = "latest"
            }
          }
        }
      }

      # Always set DATABASE_SSL=true for Supabase connections
      dynamic "env" {
        for_each = each.value.has_database && var.supabase_database_url_secret_id != "" ? [1] : []
        content {
          name  = "DATABASE_SSL"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.value.has_database && var.django_secret_key_id != "" ? [1] : []
        content {
          name = "SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = var.django_secret_key_id
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

  labels = merge(var.labels, {
    slot = var.slot
  })
}

# IAM policy to allow unauthenticated access (public)
resource "google_cloud_run_v2_service_iam_member" "invokers" {
  for_each = var.services

  project  = google_cloud_run_v2_service.services[each.key].project
  location = google_cloud_run_v2_service.services[each.key].location
  name     = google_cloud_run_v2_service.services[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Migration check jobs (only for stable slot to avoid duplicate jobs)
resource "google_cloud_run_v2_job" "migration_check" {
  for_each = var.slot == "stable" ? { for k, v in var.services : k => v if v.run_migrations } : {}

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}-migrate-check"
  location = var.region

  template {
    template {
      service_account = var.service_account_email

      containers {
        image = each.value.image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        command = ["nopo", "migrate:check", "${each.key}"]

        env {
          name  = "SERVICE_NAME"
          value = each.key
        }

        dynamic "env" {
          for_each = var.supabase_database_url_secret_id != "" ? [1] : []
          content {
            name = "DATABASE_URL"
            value_source {
              secret_key_ref {
                secret  = var.supabase_database_url_secret_id
                version = "latest"
              }
            }
          }
        }

        dynamic "env" {
          for_each = var.supabase_database_url_secret_id != "" ? [1] : []
          content {
            name  = "DATABASE_SSL"
            value = "true"
          }
        }

        dynamic "env" {
          for_each = var.django_secret_key_id != "" ? [1] : []
          content {
            name = "SECRET_KEY"
            value_source {
              secret_key_ref {
                secret  = var.django_secret_key_id
                version = "latest"
              }
            }
          }
        }
      }

      max_retries = 0
      timeout     = "120s"
    }
  }

  labels = var.labels
}

# Migration jobs (only for stable slot)
resource "google_cloud_run_v2_job" "migrations" {
  for_each = var.slot == "stable" ? { for k, v in var.services : k => v if v.run_migrations } : {}

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}-migrate"
  location = var.region

  template {
    template {
      service_account = var.service_account_email

      containers {
        image = each.value.image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        command = ["nopo", "migrate:run", "${each.key}"]

        env {
          name  = "SERVICE_NAME"
          value = each.key
        }

        dynamic "env" {
          for_each = var.supabase_database_url_secret_id != "" ? [1] : []
          content {
            name = "DATABASE_URL"
            value_source {
              secret_key_ref {
                secret  = var.supabase_database_url_secret_id
                version = "latest"
              }
            }
          }
        }

        dynamic "env" {
          for_each = var.supabase_database_url_secret_id != "" ? [1] : []
          content {
            name  = "DATABASE_SSL"
            value = "true"
          }
        }

        dynamic "env" {
          for_each = var.django_secret_key_id != "" ? [1] : []
          content {
            name = "SECRET_KEY"
            value_source {
              secret_key_ref {
                secret  = var.django_secret_key_id
                version = "latest"
              }
            }
          }
        }
      }

      max_retries = 1
      timeout     = "600s"
    }
  }

  labels = var.labels
}
