# Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "main" {
  project       = var.project_id
  location      = var.region
  repository_id = "${var.name_prefix}-repo"
  description   = "Docker repository for ${var.name_prefix}"
  format        = "DOCKER"

  docker_config {
    immutable_tags = false
  }

  labels = var.labels

  # Cleanup policies to manage storage costs
  # Runs daily, up to 30,000 deletions per repository per day
  cleanup_policy_dry_run = false

  # Keep policy: retain 15 most recent versions per image
  # Covers 2-4 weeks of deployments with rollback capability
  # GCP automatically deletes images not covered by KEEP policies
  cleanup_policies {
    id     = "keep-most-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 15
    }
  }
}

# IAM binding for public read access (optional, can be restricted)
# This allows pulling images without authentication
resource "google_artifact_registry_repository_iam_member" "reader" {
  project    = google_artifact_registry_repository.main.project
  location   = google_artifact_registry_repository.main.location
  repository = google_artifact_registry_repository.main.name
  role       = "roles/artifactregistry.reader"
  member     = "allUsers"
}
