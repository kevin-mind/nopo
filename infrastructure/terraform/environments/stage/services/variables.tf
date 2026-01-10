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

variable "terraform_state_bucket" {
  description = "The GCS bucket for Terraform state"
  type        = string
}

variable "stable_backend_image" {
  description = "Docker image for stable backend (optional - omit to skip backend deployment)"
  type        = string
  default     = null
}

variable "stable_web_image" {
  description = "Docker image for stable web (optional - omit to skip web deployment)"
  type        = string
  default     = null
}

variable "canary_backend_image" {
  description = "Docker image for canary backend (optional - omit to skip backend deployment)"
  type        = string
  default     = null
}

variable "canary_web_image" {
  description = "Docker image for canary web (optional - omit to skip web deployment)"
  type        = string
  default     = null
}
