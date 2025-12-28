output "vpc_network_id" {
  description = "The ID of the VPC network"
  value       = google_compute_network.main.id
}

output "vpc_network_name" {
  description = "The name of the VPC network"
  value       = google_compute_network.main.name
}

output "vpc_connector_id" {
  description = "The ID of the VPC access connector"
  value       = google_vpc_access_connector.main.id
}

output "subnet_id" {
  description = "The ID of the subnet"
  value       = google_compute_subnetwork.main.id
}

output "private_ip_address" {
  description = "The private IP address range for services"
  value       = google_compute_global_address.private_ip_range.name
}

output "private_vpc_connection" {
  description = "The private VPC connection"
  value       = google_service_networking_connection.private_vpc_connection.network
}
