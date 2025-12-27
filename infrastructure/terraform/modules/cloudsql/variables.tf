variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

variable "tier" {
  description = "The Cloud SQL instance tier"
  type        = string
  default     = "db-f1-micro"
}

variable "database_name" {
  description = "The name of the database"
  type        = string
}

variable "database_user" {
  description = "The database user"
  type        = string
}

variable "vpc_network_id" {
  description = "The VPC network ID"
  type        = string
}

variable "private_ip_address" {
  description = "The private IP address range name"
  type        = string
}

variable "db_password_secret_id" {
  description = "The Secret Manager secret ID for database password"
  type        = string
}
