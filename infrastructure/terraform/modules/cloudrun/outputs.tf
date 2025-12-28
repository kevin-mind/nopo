# Output all service URLs as a map
output "service_urls" {
  description = "Map of service names to their Cloud Run URLs"
  value       = { for k, v in google_cloud_run_v2_service.services : k => v.uri }
}

# Output all service names
output "service_names" {
  description = "List of deployed service names"
  value       = keys(google_cloud_run_v2_service.services)
}

# Output service account email
output "service_account_email" {
  description = "The email of the Cloud Run service account"
  value       = google_service_account.cloudrun.email
}

# For backwards compatibility - get specific service URLs
output "backend_service_url" {
  description = "The URL of the backend Cloud Run service (if exists)"
  value       = lookup(google_cloud_run_v2_service.services, "backend", null) != null ? google_cloud_run_v2_service.services["backend"].uri : ""
}

output "web_service_url" {
  description = "The URL of the web Cloud Run service (if exists)"
  value       = lookup(google_cloud_run_v2_service.services, "web", null) != null ? google_cloud_run_v2_service.services["web"].uri : ""
}
