# Output all service URLs as a map
output "service_urls" {
  description = "Map of service names to their Cloud Run URLs"
  value       = { for k, v in google_cloud_run_v2_service.services : k => v.uri }
}

# Output all service names (full names with slot suffix)
output "service_names" {
  description = "Map of service keys to their full Cloud Run service names"
  value       = { for k, v in google_cloud_run_v2_service.services : k => v.name }
}

# Output the slot
output "slot" {
  description = "The deployment slot (stable or canary)"
  value       = var.slot
}
