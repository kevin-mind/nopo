# Project Configuration
variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "The deployment environment (stage, prod)"
  type        = string
  validation {
    condition     = contains(["stage", "prod"], var.environment)
    error_message = "Environment must be 'stage' or 'prod'."
  }
}

# Domain Configuration
variable "domain" {
  description = "The domain name for the application (e.g., example.com)"
  type        = string
}

variable "subdomain_prefix" {
  description = "Prefix for the subdomain (e.g., 'app' for app.example.com). Leave empty for apex domain."
  type        = string
  default     = ""
}

# Database Configuration
variable "db_tier" {
  description = "The Cloud SQL instance tier"
  type        = string
  default     = "db-f1-micro"
}

variable "db_name" {
  description = "The name of the database"
  type        = string
  default     = "database"
}

variable "db_user" {
  description = "The database user name"
  type        = string
  default     = "app"
}

# Cloud Run Configuration
variable "backend_image" {
  description = "The Docker image for the backend service"
  type        = string
}

variable "web_image" {
  description = "The Docker image for the web service"
  type        = string
}

variable "backend_cpu" {
  description = "CPU allocation for backend (e.g., '1', '2')"
  type        = string
  default     = "1"
}

variable "backend_memory" {
  description = "Memory allocation for backend (e.g., '512Mi', '1Gi')"
  type        = string
  default     = "512Mi"
}

variable "web_cpu" {
  description = "CPU allocation for web (e.g., '1', '2')"
  type        = string
  default     = "1"
}

variable "web_memory" {
  description = "Memory allocation for web (e.g., '512Mi', '1Gi')"
  type        = string
  default     = "512Mi"
}

variable "min_instances" {
  description = "Minimum number of instances (0 for scale to zero)"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

# Labels
variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {}
}
