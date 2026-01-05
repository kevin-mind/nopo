# =============================================================================
# OUTPUTS - Used by services layer
# =============================================================================

output "name_prefix" {
  description = "The name prefix for this environment"
  value       = local.name_prefix
}

output "fqdn" {
  description = "The fully qualified domain name"
  value       = local.fqdn
}

# Artifact Registry
output "artifact_registry_url" {
  description = "The Artifact Registry URL for pushing images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.main.repository_id}"
}

output "artifact_registry_id" {
  description = "The Artifact Registry repository ID"
  value       = google_artifact_registry_repository.main.repository_id
}

# Service Account
output "service_account_email" {
  description = "The Cloud Run service account email"
  value       = google_service_account.cloudrun.email
}

# Secrets
output "django_secret_id" {
  description = "The Django secret key Secret Manager ID"
  value       = google_secret_manager_secret.django_secret.secret_id
}

output "database_url_secret_id" {
  description = "The database URL Secret Manager ID"
  value       = google_secret_manager_secret.database_url.secret_id
}

# Static Assets
output "static_bucket_name" {
  description = "The static assets bucket name"
  value       = google_storage_bucket.static.name
}

output "static_bucket_url" {
  description = "The static assets bucket URL"
  value       = "gs://${google_storage_bucket.static.name}"
}

output "static_backend_bucket_id" {
  description = "The static assets backend bucket ID for load balancer"
  value       = google_compute_backend_bucket.static.id
}

# Load Balancer
output "load_balancer_ip" {
  description = "The load balancer IP address"
  value       = google_compute_global_address.default.address
}

output "ssl_certificate_id" {
  description = "The SSL certificate ID"
  value       = google_compute_managed_ssl_certificate.default.id
}

# DNS Instructions
output "dns_instructions" {
  description = "Instructions for DNS configuration"
  value       = <<-EOT
    Configure your DNS with the following record:
    
    Type: A
    Name: ${var.subdomain_prefix != "" ? var.subdomain_prefix : "@"}
    Value: ${google_compute_global_address.default.address}
    TTL: 300 (or as preferred)
    
    SSL certificate will be automatically provisioned after DNS propagates.
  EOT
}
