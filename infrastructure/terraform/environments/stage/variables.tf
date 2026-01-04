variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "us-central1"
}

variable "domain" {
  description = "The domain name"
  type        = string
}

variable "subdomain_prefix" {
  description = "Subdomain prefix (e.g., 'stage' for stage.example.com)"
  type        = string
  default     = "stage"
}

# Dynamic services configuration
variable "services" {
  description = "Map of services to deploy"
  type = map(object({
    image          = string
    cpu            = optional(string, "1")
    memory         = optional(string, "512Mi")
    port           = optional(number, 3000)
    min_instances  = optional(number, 0)
    max_instances  = optional(number, 5)
    has_database   = optional(bool, false)
    run_migrations = optional(bool, false)
  }))
  default = {}
}

# Legacy individual image variables (used if services is empty)
variable "backend_image" {
  description = "The Docker image for the backend service"
  type        = string
  default     = ""
}

variable "web_image" {
  description = "The Docker image for the web service"
  type        = string
  default     = ""
}

variable "supabase_database_url" {
  description = "The Supabase database connection string"
  type        = string
  sensitive   = true
}
