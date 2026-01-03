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

variable "database_url" {
  description = "The database URL to store in Secret Manager"
  type        = string
  sensitive   = true
  default     = "" # Optional, if empty no version is created (or handle as error if preferred)
}
