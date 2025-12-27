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

variable "backend_image" {
  description = "The Docker image for the backend service"
  type        = string
}

variable "web_image" {
  description = "The Docker image for the web service"
  type        = string
}

variable "backend_cpu" {
  description = "CPU allocation for backend"
  type        = string
  default     = "1"
}

variable "backend_memory" {
  description = "Memory allocation for backend"
  type        = string
  default     = "512Mi"
}

variable "web_cpu" {
  description = "CPU allocation for web"
  type        = string
  default     = "1"
}

variable "web_memory" {
  description = "Memory allocation for web"
  type        = string
  default     = "512Mi"
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

variable "vpc_connector_id" {
  description = "The VPC connector ID"
  type        = string
}

variable "db_connection_name" {
  description = "The Cloud SQL connection name"
  type        = string
}

variable "db_host" {
  description = "The database host (private IP)"
  type        = string
}

variable "db_name" {
  description = "The database name"
  type        = string
}

variable "db_user" {
  description = "The database user"
  type        = string
}

variable "db_password_secret_id" {
  description = "The Secret Manager secret ID for database password"
  type        = string
}

variable "django_secret_key_id" {
  description = "The Secret Manager secret ID for Django secret key"
  type        = string
}

variable "public_url" {
  description = "The public URL of the application"
  type        = string
}
