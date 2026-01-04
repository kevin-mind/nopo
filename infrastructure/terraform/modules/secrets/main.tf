# Generate random database password
resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# Generate random Django secret key
resource "random_password" "django_secret" {
  length  = 50
  special = true
}

# Database password secret (legacy Cloud SQL)
resource "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-db-password"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

# Django secret key secret
resource "google_secret_manager_secret" "django_secret" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-django-secret"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "django_secret" {
  secret      = google_secret_manager_secret.django_secret.id
  secret_data = random_password.django_secret.result
}

# Supabase database URL secret
resource "google_secret_manager_secret" "supabase_database_url" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-supabase-db-url"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "supabase_database_url" {
  secret      = google_secret_manager_secret.supabase_database_url.id
  secret_data = var.supabase_database_url
}
