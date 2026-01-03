output "vpc_network_id" {
  description = "The ID of the VPC network"
  value       = google_compute_network.main.id
}

output "vpc_network_name" {
  description = "The name of the VPC network"
  value       = google_compute_network.main.name
}
