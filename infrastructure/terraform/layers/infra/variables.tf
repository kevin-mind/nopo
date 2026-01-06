variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
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

variable "domain" {
  description = "The domain name"
  type        = string
}

variable "subdomain_prefix" {
  description = "Subdomain prefix (e.g., 'stage' for stage.example.com)"
  type        = string
  default     = ""
}

variable "supabase_database_url" {
  description = "The Supabase database connection string"
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.supabase_database_url) > 0
    error_message = "The supabase_database_url variable cannot be empty. Ensure the SUPABASE_DATABASE_URL secret is set in GitHub Actions."
  }
}
