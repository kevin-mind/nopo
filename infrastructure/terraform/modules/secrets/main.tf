# Generate random Django secret key
resource "random_password" "django_secret" {
  length  = 50
  special = true
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

# Database URL secret (will be populated by GitHub Actions)
resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-database-url"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "database_url" {
  count       = var.database_url != "" ? 1 : 0
  secret      = google_secret_manager_secret.database_url.id
  secret_data = var.database_url
}
