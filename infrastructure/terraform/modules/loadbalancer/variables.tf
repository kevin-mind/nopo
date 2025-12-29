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

variable "domain" {
  description = "The domain name"
  type        = string
}

variable "subdomain_prefix" {
  description = "Subdomain prefix"
  type        = string
  default     = ""
}

# Dynamic services map
variable "services" {
  description = "Map of service names to their Cloud Run URLs"
  type        = map(string)
}

variable "default_service" {
  description = "The default service for unmatched paths (typically 'web')"
  type        = string
}

variable "db_services" {
  description = "List of service names that handle database/API routes"
  type        = list(string)
  default     = []
}

variable "static_backend_bucket_id" {
  description = "Backend bucket ID for static assets (optional)"
  type        = string
  default     = null
}
