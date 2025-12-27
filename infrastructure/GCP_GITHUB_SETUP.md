# GitHub Actions Setup for GCP Deployment

This guide explains how to configure GitHub Actions to automatically deploy to Google Cloud Platform using Workload Identity Federation (the recommended, keyless approach).

## Overview

Workload Identity Federation allows GitHub Actions to authenticate with GCP without storing long-lived service account keys. Instead, GitHub's OIDC tokens are exchanged for short-lived GCP credentials.

## Prerequisites

- GCP project with billing enabled
- GitHub repository
- `gcloud` CLI installed and authenticated as a project owner

## Step 1: Set Environment Variables

```bash
# Your GCP project ID
export PROJECT_ID="your-gcp-project-id"

# Your GitHub organization/username and repository name
export GITHUB_ORG="your-github-org"
export GITHUB_REPO="your-repo-name"

# GCP region
export REGION="europe-west1"
```

## Step 2: Create Service Account for GitHub Actions

```bash
# Create the service account
gcloud iam service-accounts create github-actions \
  --project="${PROJECT_ID}" \
  --display-name="GitHub Actions"

# Store the service account email
export SA_EMAIL="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant necessary roles to the service account
# Cloud Run Admin - to deploy services
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

# Service Account User - to act as other service accounts
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"

# Artifact Registry Writer - to push images
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

# Cloud SQL Admin - for database management
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.admin"

# Secret Manager Admin - to manage secrets
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.admin"

# Storage Admin - for Terraform state
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.admin"

# Compute Admin - for load balancer and networking
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/compute.admin"

# VPC Access Admin - for VPC connectors
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/vpcaccess.admin"

# Service Networking Admin - for private services
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/servicenetworking.networksAdmin"
```

## Step 3: Create Workload Identity Pool

```bash
# Create the workload identity pool
gcloud iam workload-identity-pools create "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Get the pool ID
export WORKLOAD_IDENTITY_POOL_ID=$(gcloud iam workload-identity-pools describe "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --format="value(name)")
```

## Step 4: Create Workload Identity Provider

```bash
# Create the provider (OIDC)
# The attribute-condition is REQUIRED and restricts which GitHub repos can authenticate
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == '${GITHUB_ORG}'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Get the provider name for GitHub Actions
export WORKLOAD_IDENTITY_PROVIDER=$(gcloud iam workload-identity-pools providers describe "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github" \
  --format="value(name)")

echo "Workload Identity Provider: ${WORKLOAD_IDENTITY_PROVIDER}"
```

> **Security Options for `--attribute-condition`:**
>
> | Scope | Condition |
> |-------|-----------|
> | All repos in org/user | `assertion.repository_owner == '${GITHUB_ORG}'` |
> | Specific repository | `assertion.repository == '${GITHUB_ORG}/${GITHUB_REPO}'` |
> | Multiple repositories | `assertion.repository in ['org/repo1', 'org/repo2']` |

## Step 5: Allow GitHub to Impersonate the Service Account

```bash
# Allow the specific repository to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WORKLOAD_IDENTITY_POOL_ID}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"
```

## Step 6: Create Terraform State Bucket

```bash
# Create the bucket for Terraform state
gsutil mb -p "${PROJECT_ID}" -l "${REGION}" "gs://${PROJECT_ID}-terraform-state"

# Enable versioning for state protection
gsutil versioning set on "gs://${PROJECT_ID}-terraform-state"
```

## Step 7: Configure GitHub Repository

### Repository Variables

Go to your GitHub repository → Settings → Secrets and variables → Actions → Variables

Add the following **repository variables**:

| Variable Name | Value | Description |
|---------------|-------|-------------|
| `GCP_PROJECT_ID` | `your-gcp-project-id` | Your GCP project ID |
| `GCP_ARTIFACT_REGISTRY` | `europe-west1-docker.pkg.dev/your-project-id/nopo-stage-repo` | Artifact Registry URL |
| `TERRAFORM_STATE_BUCKET` | `your-project-id-terraform-state` | GCS bucket for Terraform state |
| `DOMAIN` | `example.com` | Your domain name |

### Repository Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → Secrets

Add the following **repository secrets**:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Output from Step 4 | The full provider path |
| `GCP_SERVICE_ACCOUNT` | `github-actions@your-project-id.iam.gserviceaccount.com` | Service account email |

### Environment Configuration

Create two environments: `stage` and `prod`

Go to Settings → Environments → New environment

For each environment:

1. Create the environment (`stage`, `prod`)
2. Optionally add protection rules (e.g., required reviewers for prod)
3. Add environment-specific variables if needed

## Step 8: Verify Configuration

Print all the values you need:

```bash
echo "=========================================="
echo "GitHub Repository Configuration"
echo "=========================================="
echo ""
echo "REPOSITORY VARIABLES:"
echo "  GCP_PROJECT_ID: ${PROJECT_ID}"
echo "  GCP_ARTIFACT_REGISTRY: ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-stage-repo"
echo "  TERRAFORM_STATE_BUCKET: ${PROJECT_ID}-terraform-state"
echo "  DOMAIN: <your-domain.com>"
echo ""
echo "REPOSITORY SECRETS:"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER: ${WORKLOAD_IDENTITY_PROVIDER}"
echo "  GCP_SERVICE_ACCOUNT: ${SA_EMAIL}"
echo ""
echo "=========================================="
```

## Step 9: Initial Infrastructure Deployment

Before GitHub Actions can deploy, you need to create the initial infrastructure:

```bash
cd infrastructure/terraform/environments/stage

# Initialize Terraform
terraform init \
  -backend-config="bucket=${PROJECT_ID}-terraform-state" \
  -backend-config="prefix=nopo/stage"

# Create variables file
cat > terraform.tfvars <<EOF
project_id       = "${PROJECT_ID}"
region           = "${REGION}"
domain           = "your-domain.com"
subdomain_prefix = "stage"

# Use placeholder images for initial setup
backend_image = "gcr.io/cloudrun/hello"
web_image     = "gcr.io/cloudrun/hello"
EOF

# Apply infrastructure
terraform apply
```

Repeat for production:

```bash
cd ../prod

terraform init \
  -backend-config="bucket=${PROJECT_ID}-terraform-state" \
  -backend-config="prefix=nopo/prod"

cat > terraform.tfvars <<EOF
project_id       = "${PROJECT_ID}"
region           = "${REGION}"
domain           = "your-domain.com"
subdomain_prefix = ""

backend_image = "gcr.io/cloudrun/hello"
web_image     = "gcr.io/cloudrun/hello"
EOF

terraform apply
```

## Step 10: Configure DNS

After Terraform applies, get the load balancer IPs:

```bash
# Stage
cd infrastructure/terraform/environments/stage
terraform output load_balancer_ip

# Production
cd ../prod
terraform output load_balancer_ip
```

Add DNS records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | stage | `<stage_lb_ip>` | 300 |
| A | @ (or www) | `<prod_lb_ip>` | 300 |

## Testing the Setup

1. Push a commit to the `main` branch
2. Watch the GitHub Actions workflow
3. The workflow should:
   - Build and push images to GHCR
   - Authenticate with GCP using Workload Identity
   - Push images to Artifact Registry
   - Deploy via Terraform
   - Run smoke tests

## Troubleshooting

### "Permission denied" errors

1. Verify the service account has all required roles:

```bash
gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${SA_EMAIL}" \
  --format="table(bindings.role)"
```

2. Verify Workload Identity binding:

```bash
gcloud iam service-accounts get-iam-policy "${SA_EMAIL}" \
  --project="${PROJECT_ID}"
```

### "Invalid JWT" errors

1. Ensure the OIDC provider is configured correctly
2. Verify the repository name matches exactly (case-sensitive)
3. Check that the workflow has `id-token: write` permission

### Terraform state errors

1. Verify the state bucket exists:

```bash
gsutil ls "gs://${PROJECT_ID}-terraform-state"
```

2. Check bucket permissions:

```bash
gsutil iam get "gs://${PROJECT_ID}-terraform-state"
```

### Cloud Run deployment failures

1. Check Cloud Run logs:

```bash
gcloud run services logs read nopo-stage-backend --region="${REGION}" --limit=50
```

2. Verify the image exists in Artifact Registry:

```bash
gcloud artifacts docker images list "${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-stage-repo"
```

## Security Best Practices

1. **Least Privilege**: The service account has only the permissions needed
2. **No Long-Lived Keys**: Using Workload Identity means no secrets to rotate
3. **Repository Scoping**: Only your specific repository can authenticate
4. **Environment Protection**: Add required reviewers for production deployments
5. **Audit Logging**: Enable Cloud Audit Logs for IAM and Cloud Run

## Cleanup

To remove the GitHub Actions integration:

```bash
# Remove Workload Identity binding
gcloud iam service-accounts remove-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WORKLOAD_IDENTITY_POOL_ID}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"

# Delete the Workload Identity provider
gcloud iam workload-identity-pools providers delete "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github"

# Delete the Workload Identity pool
gcloud iam workload-identity-pools delete "github" \
  --project="${PROJECT_ID}" \
  --location="global"

# Delete the service account
gcloud iam service-accounts delete "${SA_EMAIL}" --project="${PROJECT_ID}"
```
