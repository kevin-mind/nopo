output "db_password_secret_id" {
  description = "The ID of the database password secret"
  value       = google_secret_manager_secret.db_password.secret_id
}

output "django_secret_key_id" {
  description = "The ID of the Django secret key secret"
  value       = google_secret_manager_secret.django_secret.secret_id
}

output "db_password_secret_name" {
  description = "The full name of the database password secret"
  value       = google_secret_manager_secret.db_password.name
}

output "django_secret_key_name" {
  description = "The full name of the Django secret key secret"
  value       = google_secret_manager_secret.django_secret.name
}
