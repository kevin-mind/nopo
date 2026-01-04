output "db_password_secret_id" {
  description = "The ID of the database password secret"
  value       = google_secret_manager_secret.db_password.secret_id
  depends_on  = [google_secret_manager_secret_version.db_password]
}

output "django_secret_key_id" {
  description = "The ID of the Django secret key secret"
  value       = google_secret_manager_secret.django_secret.secret_id
  depends_on  = [google_secret_manager_secret_version.django_secret]
}

output "db_password_secret_name" {
  description = "The full name of the database password secret"
  value       = google_secret_manager_secret.db_password.name
  depends_on  = [google_secret_manager_secret_version.db_password]
}

output "django_secret_key_name" {
  description = "The full name of the Django secret key secret"
  value       = google_secret_manager_secret.django_secret.name
  depends_on  = [google_secret_manager_secret_version.django_secret]
}
