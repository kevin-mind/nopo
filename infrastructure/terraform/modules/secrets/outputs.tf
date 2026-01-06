output "django_secret_key_id" {
  description = "The ID of the Django secret key secret"
  value       = google_secret_manager_secret.django_secret.secret_id
  depends_on  = [google_secret_manager_secret_version.django_secret]
}

output "supabase_database_url_secret_id" {
  description = "The ID of the Supabase database URL secret"
  value       = google_secret_manager_secret.supabase_database_url.secret_id
  depends_on  = [google_secret_manager_secret_version.supabase_database_url]
}

output "django_secret_key_name" {
  description = "The full name of the Django secret key secret"
  value       = google_secret_manager_secret.django_secret.name
  depends_on  = [google_secret_manager_secret_version.django_secret]
}
