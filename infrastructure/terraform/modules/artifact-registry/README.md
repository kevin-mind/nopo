# Artifact Registry Module

This module creates and manages a Google Cloud Artifact Registry repository for Docker images.

## Features

- **Docker Repository**: Stores Docker container images for backend and web services
- **Automatic Cleanup**: Manages storage costs through automated image retention policies
- **IAM Integration**: Public read access for pulling images without authentication

## Cleanup Policies

The module implements a keep-based cleanup policy that runs daily to manage storage costs.

### Keep Most Recent Policy

**Purpose**: Retain the 15 most recent image versions per image

**Rationale**:
- Covers 2-4 weeks of deployments based on current frequency
- Provides sufficient rollback capability for typical issues
- Balances cost optimization with operational safety
- **GCP automatically deletes images not covered by KEEP policies**, eliminating the need for explicit DELETE policies

**Configuration**:
```hcl
cleanup_policies {
  id     = "keep-most-recent"
  action = "KEEP"

  most_recent_versions {
    keep_count = 15
  }
}
```

### Why KEEP-only (No DELETE Policy)

**Recommended approach**: Use only KEEP policies, not DELETE policies.

**Rationale**:
- GCP automatically removes images not covered by KEEP policies after the daily cleanup run
- DELETE policies create unnecessary complexity and potential edge cases
- KEEP policies provide clearer intent: "retain these specific versions"
- Simpler configuration is easier to understand and maintain

### Policy Execution

- **Frequency**: Once per day
- **Limit**: Up to 30,000 deletions per repository per day
- **Automatic deletion**: GCP deletes all images not matched by KEEP policies
- **Dry Run**: Set `cleanup_policy_dry_run = true` to test policies without deleting images

## Usage

```hcl
module "artifact_registry" {
  source = "./modules/artifact-registry"

  project_id  = "my-project"
  region      = "us-central1"
  name_prefix = "nopo-prod"

  labels = {
    environment = "production"
    managed_by  = "terraform"
  }
}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| project_id | The GCP project ID | string | - | yes |
| region | The GCP region | string | - | yes |
| name_prefix | Prefix for resource names | string | - | yes |
| labels | Labels to apply to resources | map(string) | {} | no |

## Outputs

| Name | Description |
|------|-------------|
| repository_url | The URL of the Artifact Registry repository |
| repository_name | The name of the Artifact Registry repository |
| repository_id | The ID of the Artifact Registry repository |

## Storage Cost Management

### Expected Impact

With cleanup policies enabled:
- **Before**: Unlimited image accumulation (~$1-5+/month, growing)
- **After**: ~15 images per service (~$1-3/month, stable)
- **Savings**: Prevents unbounded growth and associated storage costs

### Monitoring

To monitor cleanup policy effectiveness:

```bash
# List images in repository
gcloud artifacts docker images list \
  ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_ID}

# View cleanup policy dry run results
gcloud artifacts repositories describe ${REPO_ID} \
  --location=${REGION} \
  --format="value(cleanupPolicyDryRun)"
```

## Adjusting Retention Count

If you need to adjust the retention count based on your deployment patterns:

1. **Higher frequency deployments**: Increase `keep_count` to maintain longer rollback window
2. **Lower frequency deployments**: Decrease `keep_count` to reduce storage costs

## References

- [GCP Artifact Registry Cleanup Policies](https://cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
- [Terraform Google Provider - Artifact Registry](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/artifact_registry_repository)
