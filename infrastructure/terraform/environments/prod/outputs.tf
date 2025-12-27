output "load_balancer_ip" {
  description = "The IP address of the load balancer"
  value       = module.infrastructure.load_balancer_ip
}

output "public_url" {
  description = "The public URL"
  value       = module.infrastructure.public_url
}

output "backend_service_url" {
  description = "The backend Cloud Run service URL"
  value       = module.infrastructure.backend_service_url
}

output "web_service_url" {
  description = "The web Cloud Run service URL"
  value       = module.infrastructure.web_service_url
}

output "artifact_registry_url" {
  description = "The Artifact Registry URL"
  value       = module.infrastructure.artifact_registry_url
}

output "dns_instructions" {
  description = "DNS configuration instructions"
  value       = module.infrastructure.dns_instructions
}
