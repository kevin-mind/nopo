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

variable "backend_service_url" {
  description = "The URL of the backend Cloud Run service (not used directly)"
  type        = string
}

variable "web_service_url" {
  description = "The URL of the web Cloud Run service (not used directly)"
  type        = string
}

variable "name_prefix" {
  description = "Name prefix for resources (used to reference Cloud Run services)"
  type        = string
}
