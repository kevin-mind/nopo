# Service account for Cloud Run services
resource "google_service_account" "cloudrun" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-cloudrun"
  display_name = "${var.name_prefix} Cloud Run Service Account"
}

# Grant Cloud SQL Client role to the service account
resource "google_project_iam_member" "cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Grant Secret Manager access for each secret
resource "google_secret_manager_secret_iam_member" "db_password_access" {
  count     = var.db_password_secret_id != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.db_password_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "django_secret_access" {
  count     = var.django_secret_key_id != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.django_secret_key_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "supabase_db_url_access" {
  count     = var.supabase_database_url_secret_id != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.supabase_database_url_secret_id
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

    dynamic "vpc_access" {
      for_each = each.value.has_database && var.vpc_connector_id != "" ? [1] : []
      content {
        connector = var.vpc_connector_id
        egress    = "PRIVATE_RANGES_ONLY"
      }
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

      # Cloud SQL connection (only if db_connection_name is provided)
      dynamic "volume_mounts" {
        for_each = each.value.has_database && var.db_connection_name != "" ? [1] : []
        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
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

    dynamic "volumes" {
      for_each = each.value.has_database && var.db_connection_name != "" ? [1] : []
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.db_connection_name]
        }
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

# Migration check jobs
resource "google_cloud_run_v2_job" "migration_check" {
  for_each = { for k, v in var.services : k => v if v.run_migrations }

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}-migrate-check"
  location = var.region

  template {
    template {
      service_account = google_service_account.cloudrun.email

      dynamic "vpc_access" {
        for_each = var.vpc_connector_id != "" ? [1] : []
        content {
          connector = var.vpc_connector_id
          egress    = "PRIVATE_RANGES_ONLY"
        }
      }

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

        dynamic "volume_mounts" {
          for_each = var.db_connection_name != "" ? [1] : []
          content {
            name       = "cloudsql"
            mount_path = "/cloudsql"
          }
        }
      }

      dynamic "volumes" {
        for_each = var.db_connection_name != "" ? [1] : []
        content {
          name = "cloudsql"
          cloud_sql_instance {
            instances = [var.db_connection_name]
          }
        }
      }

      max_retries = 0
      timeout     = "120s"
    }
  }

  labels = var.labels
}

# Migration jobs
resource "google_cloud_run_v2_job" "migrations" {
  for_each = { for k, v in var.services : k => v if v.run_migrations }

  project  = var.project_id
  name     = "${var.name_prefix}-${each.key}-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.cloudrun.email

      dynamic "vpc_access" {
        for_each = var.vpc_connector_id != "" ? [1] : []
        content {
          connector = var.vpc_connector_id
          egress    = "PRIVATE_RANGES_ONLY"
        }
      }

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

        dynamic "volume_mounts" {
          for_each = var.db_connection_name != "" ? [1] : []
          content {
            name       = "cloudsql"
            mount_path = "/cloudsql"
          }
        }
      }

      dynamic "volumes" {
        for_each = var.db_connection_name != "" ? [1] : []
        content {
          name = "cloudsql"
          cloud_sql_instance {
            instances = [var.db_connection_name]
          }
        }
      }

      max_retries = 1
      timeout     = "600s"
    }
  }

  labels = var.labels
}
