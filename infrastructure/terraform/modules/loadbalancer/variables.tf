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

# Stable slot service names (map of service key -> full Cloud Run service name)
variable "stable_services" {
  description = "Map of service keys to their stable Cloud Run service names"
  type        = map(string)
}

# Canary slot service names (map of service key -> full Cloud Run service name)
variable "canary_services" {
  description = "Map of service keys to their canary Cloud Run service names"
  type        = map(string)
}

variable "default_service" {
  description = "The default service for unmatched hosts (typically 'web')"
  type        = string
}

variable "static_backend_bucket_id" {
  description = "Backend bucket ID for static assets (optional)"
  type        = string
  default     = null
}

variable "canary_header_name" {
  description = "HTTP header name for canary routing"
  type        = string
  default     = "X-Force-Canary"
}

variable "canary_header_value" {
  description = "HTTP header value that triggers canary routing"
  type        = string
  default     = "true"
}
