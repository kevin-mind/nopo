# Cloud SQL instance
resource "google_sql_database_instance" "main" {
  project          = var.project_id
  name             = "${var.name_prefix}-db"
  region           = var.region
  database_version = "POSTGRES_16"

  settings {
    tier              = var.tier
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.vpc_network_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7
      hour = 3
    }

    insights_config {
      query_insights_enabled  = true
      query_plans_per_minute  = 5
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
    }

    user_labels = var.labels
  }

  deletion_protection = true

  depends_on = [var.private_ip_address]
}

# Database
resource "google_sql_database" "main" {
  project  = var.project_id
  name     = var.database_name
  instance = google_sql_database_instance.main.name
}

# Database user with password from Secret Manager
data "google_secret_manager_secret_version" "db_password" {
  project = var.project_id
  secret  = var.db_password_secret_id
  version = "latest"
}

resource "google_sql_user" "main" {
  project  = var.project_id
  name     = var.database_user
  instance = google_sql_database_instance.main.name
  password = data.google_secret_manager_secret_version.db_password.secret_data
}
