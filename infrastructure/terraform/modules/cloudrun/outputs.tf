output "backend_service_url" {
  description = "The URL of the backend Cloud Run service"
  value       = google_cloud_run_v2_service.backend.uri
}

output "web_service_url" {
  description = "The URL of the web Cloud Run service"
  value       = google_cloud_run_v2_service.web.uri
}

output "backend_service_name" {
  description = "The name of the backend Cloud Run service"
  value       = google_cloud_run_v2_service.backend.name
}

output "web_service_name" {
  description = "The name of the web Cloud Run service"
  value       = google_cloud_run_v2_service.web.name
}

output "service_account_email" {
  description = "The email of the Cloud Run service account"
  value       = google_service_account.cloudrun.email
}
