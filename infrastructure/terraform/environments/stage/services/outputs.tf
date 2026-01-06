output "public_url" {
  description = "The public URL"
  value       = module.services.public_url
}

output "stable_service_urls" {
  description = "URLs for stable slot services"
  value       = module.services.stable_service_urls
}

output "canary_service_urls" {
  description = "URLs for canary slot services"
  value       = module.services.canary_service_urls
}

output "canary_header" {
  description = "Header for canary routing"
  value       = module.services.canary_header
}
