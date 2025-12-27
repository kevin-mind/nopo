variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "europe-west1"
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

variable "backend_image" {
  description = "The Docker image for the backend service"
  type        = string
}

variable "web_image" {
  description = "The Docker image for the web service"
  type        = string
}
