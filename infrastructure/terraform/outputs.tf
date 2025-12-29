# Load Balancer outputs
output "load_balancer_ip" {
  description = "The IP address of the load balancer"
  value       = module.loadbalancer.ip_address
}

output "public_url" {
  description = "The public URL of the application"
  value       = "https://${local.fqdn}"
}

# Cloud Run outputs (dynamic)
output "service_urls" {
  description = "Map of service names to their Cloud Run URLs"
  value       = module.cloudrun.service_urls
}

output "service_names" {
  description = "List of deployed service names"
  value       = module.cloudrun.service_names
}

# Backwards compatibility
output "backend_service_url" {
  description = "The URL of the backend Cloud Run service (if exists)"
  value       = module.cloudrun.backend_service_url
}

output "web_service_url" {
  description = "The URL of the web Cloud Run service (if exists)"
  value       = module.cloudrun.web_service_url
}

# Database outputs
output "db_connection_name" {
  description = "The Cloud SQL connection name"
  value       = length(module.cloudsql) > 0 ? module.cloudsql[0].connection_name : ""
}

output "db_private_ip" {
  description = "The private IP of the Cloud SQL instance"
  value       = length(module.cloudsql) > 0 ? module.cloudsql[0].private_ip : ""
}

# Artifact Registry outputs
output "artifact_registry_url" {
  description = "The URL of the Artifact Registry"
  value       = module.artifact_registry.repository_url
}

# VPC outputs
output "vpc_network_name" {
  description = "The name of the VPC network"
  value       = module.networking.vpc_network_name
}

# DNS Configuration
output "dns_instructions" {
  description = "Instructions for DNS configuration"
  value       = <<-EOT
    Configure your DNS with the following record:
    
    Type: A
    Name: ${var.subdomain_prefix != "" ? var.subdomain_prefix : "@"}
    Value: ${module.loadbalancer.ip_address}
    TTL: 300 (or as preferred)
    
    SSL certificate will be automatically provisioned after DNS propagates.
  EOT
}

# Services summary
output "services_summary" {
  description = "Summary of deployed services"
  value = {
    total_services = length(module.cloudrun.service_names)
    services       = module.cloudrun.service_names
    urls           = module.cloudrun.service_urls
  }
}

# Static assets outputs
output "static_bucket_name" {
  description = "Name of the static assets bucket"
  value       = var.enable_static_bucket ? module.static_assets[0].bucket_name : ""
}

output "static_bucket_url" {
  description = "GCS URL for uploading static assets"
  value       = var.enable_static_bucket ? module.static_assets[0].bucket_url : ""
}
