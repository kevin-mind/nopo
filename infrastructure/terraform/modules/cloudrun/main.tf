# Service account for Cloud Run services
resource "google_service_account" "cloudrun" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-cloudrun"
  display_name = "${var.name_prefix} Cloud Run Service Account"
}

# Grant Secret Manager access for Django secret key
resource "google_secret_manager_secret_iam_member" "django_secret_access" {
  count     = var.django_secret_key_id != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.django_secret_key_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Grant Secret Manager access for database URL
resource "google_secret_manager_secret_iam_member" "database_url_access" {
  count     = var.database_url_secret_id != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.database_url_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Dynamic Cloud Run services based on var.services
resource "google_cloud_run_v2_service" "services" {
  for_each = var.services

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}"
  location = var.region

  template {
    service_account = google_service_account.cloudrun.email

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
      # Note: PORT is automatically set by Cloud Run based on the container port
      env {
        name  = "SERVICE_NAME"
        value = each.key
      }

      env {
        name  = "DATABASE_SSL"
        value = "True"
      }

      dynamic "env" {
        for_each = var.database_url_secret_id != "" ? [1] : []
        content {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.database_url_secret_id
              version = "latest"
            }
          }
        }
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

  labels = var.labels
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

# Migration check jobs for services that need migrations
# These jobs check if there are pending migrations without applying them
resource "google_cloud_run_v2_job" "migration_check" {
  for_each = { for k, v in var.services : k => v if v.run_migrations }

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}-migrate-check"
  location = var.region

  template {
    template {
      service_account = google_service_account.cloudrun.email

      containers {
        image = each.value.image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        # Check for pending migrations (exits 0 if none, 1 if pending)
        command = ["nopo", "migrate", "check", "${each.key}"]

        env {
          name  = "SERVICE_NAME"
          value = each.key
        }

        env {
          name  = "DATABASE_SSL"
          value = "True"
        }

        dynamic "env" {
          for_each = var.database_url_secret_id != "" ? [1] : []
          content {
            name = "DATABASE_URL"
            value_source {
              secret_key_ref {
                secret  = var.database_url_secret_id
                version = "latest"
              }
            }
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

# Migration jobs for services that need them
resource "google_cloud_run_v2_job" "migrations" {
  for_each = { for k, v in var.services : k => v if v.run_migrations }

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.cloudrun.email

      containers {
        image = each.value.image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        # Override command to run migrations
        command = ["nopo", "migrate", "run", "${each.key}"]

        env {
          name  = "SERVICE_NAME"
          value = each.key
        }

        env {
          name  = "DATABASE_SSL"
          value = "True"
        }

        dynamic "env" {
          for_each = var.database_url_secret_id != "" ? [1] : []
          content {
            name = "DATABASE_URL"
            value_source {
              secret_key_ref {
                secret  = var.database_url_secret_id
                version = "latest"
              }
            }
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
