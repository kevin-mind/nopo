# Artifact Registry Module

This module creates and manages a Google Cloud Artifact Registry repository for Docker images.

## Features

- **Docker Repository**: Stores Docker container images for backend and web services
- **Automatic Cleanup**: Manages storage costs through automated image retention policies
- **IAM Integration**: Public read access for pulling images without authentication

## Cleanup Policies

The module implements two cleanup policies that run daily to manage storage costs:

### 1. Keep Most Recent Policy

**Purpose**: Retain the 15 most recent image versions per service

**Rationale**:
- Covers 2-4 weeks of deployments based on current frequency
- Provides sufficient rollback capability for typical issues
- Balances cost optimization with operational safety

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

### 2. Delete Old Images Policy

**Purpose**: Remove images older than 7 days as a safety backup

**Rationale**:
- Catches orphaned images not covered by the keep policy
- Provides additional cost protection
- 7-day window allows for extended rollback scenarios

**Configuration**:
```hcl
cleanup_policies {
  id     = "delete-old-images"
  action = "DELETE"

  condition {
    older_than = "604800s"  # 7 days
  }
}
```

### Policy Execution

- **Frequency**: Once per day
- **Limit**: Up to 30,000 deletions per repository per day
- **Priority**: Keep policies take precedence over delete policies (if an image matches both, it is kept)
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
3. **Compliance requirements**: Adjust `older_than` to meet data retention policies

## References

- [GCP Artifact Registry Cleanup Policies](https://cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
- [Terraform Google Provider - Artifact Registry](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/artifact_registry_repository)
