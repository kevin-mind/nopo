output "artifact_registry_url" {
  description = "Artifact Registry URL for pushing images"
  value       = module.infra.artifact_registry_url
}

output "static_bucket_name" {
  description = "Static assets bucket name"
  value       = module.infra.static_bucket_name
}

output "load_balancer_ip" {
  description = "Load balancer IP address"
  value       = module.infra.load_balancer_ip
}

output "dns_instructions" {
  description = "DNS configuration instructions"
  value       = module.infra.dns_instructions
}

output "service_account_email" {
  value = module.infra.service_account_email
}

output "django_secret_id" {
  value = module.infra.django_secret_id
}

output "database_url_secret_id" {
  value = module.infra.database_url_secret_id
}

output "static_backend_bucket_id" {
  value = module.infra.static_backend_bucket_id
}

output "ssl_certificate_id" {
  value = module.infra.ssl_certificate_id
}
