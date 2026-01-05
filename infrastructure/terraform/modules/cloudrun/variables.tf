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

# Dynamic services configuration
variable "services" {
  description = "Map of services to deploy"
  type = map(object({
    image          = string
    cpu            = string
    memory         = string
    port           = number
    min_instances  = number
    max_instances  = number
    has_database   = bool
    run_migrations = bool
  }))
}

variable "django_secret_key_id" {
  description = "The Secret Manager secret ID for Django secret key"
  type        = string
  default     = ""
}

variable "public_url" {
  description = "The public URL of the application"
  type        = string
}

variable "static_url_base" {
  description = "Base URL for static files (e.g., https://domain.com/static). Service name will be appended."
  type        = string
  default     = ""
}

variable "supabase_database_url_secret_id" {
  description = "The Secret Manager secret ID for Supabase database URL"
  type        = string
  default     = ""
}
