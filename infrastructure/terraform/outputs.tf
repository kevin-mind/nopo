# Load Balancer outputs
output "load_balancer_ip" {
  description = "The IP address of the load balancer"
  value       = module.loadbalancer.ip_address
}

output "public_url" {
  description = "The public URL of the application"
  value       = "https://${local.fqdn}"
}

# Cloud Run outputs
output "backend_service_url" {
  description = "The URL of the backend Cloud Run service"
  value       = module.cloudrun.backend_service_url
}

output "web_service_url" {
  description = "The URL of the web Cloud Run service"
  value       = module.cloudrun.web_service_url
}

# Database outputs
output "db_connection_name" {
  description = "The Cloud SQL connection name"
  value       = module.cloudsql.connection_name
}

output "db_private_ip" {
  description = "The private IP of the Cloud SQL instance"
  value       = module.cloudsql.private_ip
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
