output "public_url" {
  description = "The public URL"
  value       = local.public_url
}

output "stable_service_urls" {
  description = "URLs for stable slot services"
  value       = { for k, v in google_cloud_run_v2_service.stable : k => v.uri }
}

output "canary_service_urls" {
  description = "URLs for canary slot services"
  value       = { for k, v in google_cloud_run_v2_service.canary : k => v.uri }
}

output "canary_header" {
  description = "Header to send for canary routing"
  value       = "X-Force-Canary: true"
}

output "canary_curl_example" {
  description = "Example curl command to test canary"
  value       = "curl -H 'X-Force-Canary: true' ${local.public_url}"
}
