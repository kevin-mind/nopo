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

variable "terraform_state_bucket" {
  description = "The GCS bucket containing Terraform state (for reading infra layer outputs)"
  type        = string
}

# =============================================================================
# STABLE SLOT IMAGES
# =============================================================================

variable "stable_backend_image" {
  description = "Docker image for the stable backend service (optional - omit to skip backend deployment)"
  type        = string
  default     = null
}

variable "stable_web_image" {
  description = "Docker image for the stable web service (optional - omit to skip web deployment)"
  type        = string
  default     = null
}

# =============================================================================
# CANARY SLOT IMAGES
# =============================================================================

variable "canary_backend_image" {
  description = "Docker image for the canary backend service (optional - omit to skip backend deployment)"
  type        = string
  default     = null
}

variable "canary_web_image" {
  description = "Docker image for the canary web service (optional - omit to skip web deployment)"
  type        = string
  default     = null
}
