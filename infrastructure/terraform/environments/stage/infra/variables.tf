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

variable "supabase_database_url" {
  description = "The Supabase database connection string"
  type        = string
  sensitive   = true
}
