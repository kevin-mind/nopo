output "connection_name" {
  description = "The connection name for Cloud SQL"
  value       = google_sql_database_instance.main.connection_name
}

output "private_ip" {
  description = "The private IP address of the Cloud SQL instance"
  value       = google_sql_database_instance.main.private_ip_address
}

output "instance_name" {
  description = "The name of the Cloud SQL instance"
  value       = google_sql_database_instance.main.name
}

output "database_name" {
  description = "The name of the database"
  value       = google_sql_database.main.name
}
