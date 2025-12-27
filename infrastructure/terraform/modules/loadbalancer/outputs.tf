output "ip_address" {
  description = "The IP address of the load balancer"
  value       = google_compute_global_address.default.address
}

output "url_map_name" {
  description = "The name of the URL map"
  value       = google_compute_url_map.default.name
}

output "ssl_certificate_name" {
  description = "The name of the SSL certificate"
  value       = google_compute_managed_ssl_certificate.default.name
}
