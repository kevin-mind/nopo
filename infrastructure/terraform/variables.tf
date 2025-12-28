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
  description = "Prefix for the subdomain (e.g., 'stage' for stage.example.com). Leave empty for apex domain."
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

# Dynamic Services Configuration
variable "services" {
  description = "Map of services to deploy, keyed by service name"
  type = map(object({
    image          = string
    cpu            = optional(string, "1")
    memory         = optional(string, "512Mi")
    port           = optional(number, 3000)
    min_instances  = optional(number, 0)
    max_instances  = optional(number, 10)
    has_database   = optional(bool, false)
    run_migrations = optional(bool, false)
  }))
  default = {}
}

# Backwards compatibility - individual image variables
# These are used if services map is empty
variable "backend_image" {
  description = "The Docker image for the backend service (legacy, use services instead)"
  type        = string
  default     = ""
}

variable "web_image" {
  description = "The Docker image for the web service (legacy, use services instead)"
  type        = string
  default     = ""
}

# Static Assets Configuration
variable "enable_static_bucket" {
  description = "Enable Cloud Storage bucket for static assets (served via CDN). When disabled, static files are served by the application."
  type        = bool
  default     = false
}

# Labels
variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {}
}
