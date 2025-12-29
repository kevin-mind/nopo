output "bucket_name" {
  description = "Name of the static assets bucket"
  value       = google_storage_bucket.static.name
}

output "bucket_url" {
  description = "URL of the static assets bucket"
  value       = google_storage_bucket.static.url
}

output "backend_bucket_id" {
  description = "ID of the backend bucket for load balancer"
  value       = google_compute_backend_bucket.static.id
}

output "backend_bucket_self_link" {
  description = "Self link of the backend bucket"
  value       = google_compute_backend_bucket.static.self_link
}

output "public_url" {
  description = "Public URL for accessing static assets"
  value       = "https://storage.googleapis.com/${google_storage_bucket.static.name}"
}
