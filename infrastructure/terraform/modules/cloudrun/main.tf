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

# Grant Secret Manager access
resource "google_secret_manager_secret_iam_member" "db_password_access" {
  project   = var.project_id
  secret_id = var.db_password_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "django_secret_access" {
  project   = var.project_id
  secret_id = var.django_secret_key_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Backend Cloud Run service
resource "google_cloud_run_v2_service" "backend" {
  project  = var.project_id
  name     = "${var.name_prefix}-backend"
  location = var.region

  template {
    service_account = google_service_account.cloudrun.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.backend_image

      resources {
        limits = {
          cpu    = var.backend_cpu
          memory = var.backend_memory
        }
        cpu_idle = true
      }

      ports {
        container_port = 3000
      }

      # Environment variables
      env {
        name  = "SERVICE_NAME"
        value = "backend"
      }

      env {
        name  = "PORT"
        value = "3000"
      }

      env {
        name  = "SITE_URL"
        value = var.public_url
      }

      env {
        name  = "DB_HOST"
        value = var.db_host
      }

      env {
        name  = "DB_NAME"
        value = var.db_name
      }

      env {
        name  = "DB_USER"
        value = var.db_user
      }

      env {
        name  = "DATABASE_URL"
        value = "postgresql://${var.db_user}:$(DB_PASSWORD)@${var.db_host}:5432/${var.db_name}"
      }

      # Secret environment variables
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = var.db_password_secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = var.django_secret_key_id
            version = "latest"
          }
        }
      }

      # Cloud SQL connection
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      startup_probe {
        http_get {
          path = "/__version__"
          port = 3000
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/__version__"
          port = 3000
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.db_connection_name]
      }
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }

  labels = var.labels
}

# Web Cloud Run service
resource "google_cloud_run_v2_service" "web" {
  project  = var.project_id
  name     = "${var.name_prefix}-web"
  location = var.region

  template {
    service_account = google_service_account.cloudrun.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.web_image

      resources {
        limits = {
          cpu    = var.web_cpu
          memory = var.web_memory
        }
        cpu_idle = true
      }

      ports {
        container_port = 3000
      }

      env {
        name  = "SERVICE_NAME"
        value = "web"
      }

      env {
        name  = "PORT"
        value = "3000"
      }

      startup_probe {
        http_get {
          path = "/__version__"
          port = 3000
        }
        initial_delay_seconds = 5
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/__version__"
          port = 3000
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
resource "google_cloud_run_v2_service_iam_member" "backend_invoker" {
  project  = google_cloud_run_v2_service.backend.project
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "web_invoker" {
  project  = google_cloud_run_v2_service.web.project
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Migration job for running database migrations
resource "google_cloud_run_v2_job" "migrate" {
  project  = var.project_id
  name     = "${var.name_prefix}-backend-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.cloudrun.email

      vpc_access {
        connector = var.vpc_connector_id
        egress    = "PRIVATE_RANGES_ONLY"
      }

      containers {
        image = var.backend_image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        # Override command to run migrations
        command = ["pnpm", "run", "--filter=@more/backend", "migrate"]

        env {
          name  = "SERVICE_NAME"
          value = "backend"
        }

        env {
          name  = "DB_HOST"
          value = var.db_host
        }

        env {
          name  = "DB_NAME"
          value = var.db_name
        }

        env {
          name  = "DB_USER"
          value = var.db_user
        }

        env {
          name = "DB_PASSWORD"
          value_source {
            secret_key_ref {
              secret  = var.db_password_secret_id
              version = "latest"
            }
          }
        }

        env {
          name = "SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = var.django_secret_key_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.db_connection_name]
        }
      }

      max_retries = 1
      timeout     = "600s"
    }
  }

  labels = var.labels
}
