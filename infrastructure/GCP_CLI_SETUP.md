# GCP CLI Setup Guide

This guide covers installing the Google Cloud CLI and provisioning all required resources for deploying the application to Google Cloud Platform.

## Table of Contents

1. [Install Google Cloud CLI](#1-install-google-cloud-cli)
2. [Initial Authentication](#2-initial-authentication)
3. [Create GCP Project](#3-create-gcp-project)
4. [Enable Required APIs](#4-enable-required-apis)
5. [Create Terraform State Bucket](#5-create-terraform-state-bucket)
6. [Create Service Account for GitHub Actions](#6-create-service-account-for-github-actions)
7. [Setup Workload Identity Federation](#7-setup-workload-identity-federation)
8. [Create Artifact Registry Repository](#8-create-artifact-registry-repository)
9. [Initial Secrets Setup](#9-initial-secrets-setup)
10. [Verify Setup](#10-verify-setup)
11. [Next Steps](#11-next-steps)

---

## 1. Install Google Cloud CLI

### macOS

Using Homebrew (recommended):

```bash
brew install --cask google-cloud-sdk
```

Or download directly:

```bash
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz
tar -xf google-cloud-cli-darwin-arm.tar.gz
./google-cloud-sdk/install.sh
```

### Linux (Debian/Ubuntu)

```bash
# Add the Cloud SDK distribution URI as a package source
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list

# Import the Google Cloud public key
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -

# Update and install the CLI
sudo apt-get update && sudo apt-get install google-cloud-cli
```

### Linux (RHEL/CentOS/Fedora)

```bash
# Add the Cloud SDK repo
sudo tee -a /etc/yum.repos.d/google-cloud-sdk.repo << EOM
[google-cloud-cli]
name=Google Cloud CLI
baseurl=https://packages.cloud.google.com/yum/repos/cloud-sdk-el8-x86_64
enabled=1
gpgcheck=1
repo_gpgcheck=0
gpgkey=https://packages.cloud.google.com/yum/doc/rpm-package-key.gpg
EOM

# Install the CLI
sudo dnf install google-cloud-cli
```

### Windows

Download and run the installer:

```powershell
# Download installer
Invoke-WebRequest -Uri "https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe" -OutFile "GoogleCloudSDKInstaller.exe"

# Run installer
.\GoogleCloudSDKInstaller.exe
```

Or use Chocolatey:

```powershell
choco install gcloudsdk
```

### Docker (for CI/CD or containerized environments)

```bash
docker run -it --rm google/cloud-sdk:latest gcloud version
```

### Verify Installation

```bash
gcloud version
```

Expected output:

```text
Google Cloud SDK 4xx.x.x
bq 2.x.x
core 2024.xx.xx
gcloud-crc32c 1.x.x
gsutil 5.x
```

---

## 2. Initial Authentication

### Interactive Login (for local development)

```bash
# Login to your Google account
gcloud auth login

# This will open a browser window for authentication
# After authenticating, you'll see: "You are now logged in as [your-email]"
```

### Application Default Credentials (for local Terraform)

```bash
# Set up application default credentials
gcloud auth application-default login

# This creates credentials at ~/.config/gcloud/application_default_credentials.json
```

### Verify Authentication

```bash
# List authenticated accounts
gcloud auth list

# Should show your email with an asterisk (*) indicating active account
```

---

## 3. Create GCP Project

### Set Environment Variables

Create a file to store your configuration (don't commit this):

```bash
# Create config file
cat > ~/.gcp-nopo-config << 'EOF'
# GCP Configuration for Nopo Project
export PROJECT_ID="nopo-your-unique-id"      # Must be globally unique
export PROJECT_NAME="Nopo Application"
export BILLING_ACCOUNT_ID=""                  # Fill after step 3.2
export REGION="europe-west1"
export GITHUB_ORG="your-github-org"           # Your GitHub username or org
export GITHUB_REPO="your-repo-name"           # Your repository name
export DOMAIN="example.com"                   # Your domain
EOF

# Load the config
source ~/.gcp-nopo-config
```

### List Available Billing Accounts

```bash
# List billing accounts you have access to
gcloud billing accounts list

# Output example:
# ACCOUNT_ID            NAME                 OPEN  MASTER_ACCOUNT_ID
# 0X0X0X-0X0X0X-0X0X0X  My Billing Account   True

# Update your config with the billing account ID
sed -i.bak "s/BILLING_ACCOUNT_ID=\"\"/BILLING_ACCOUNT_ID=\"0X0X0X-0X0X0X-0X0X0X\"/" ~/.gcp-nopo-config
source ~/.gcp-nopo-config
```

### Create the Project

```bash
# Create a new GCP project
gcloud projects create "${PROJECT_ID}" \
  --name="${PROJECT_NAME}" \
  --set-as-default

# Verify project was created
gcloud projects describe "${PROJECT_ID}"
```

### Link Billing Account

```bash
# Link the billing account to the project
gcloud billing projects link "${PROJECT_ID}" \
  --billing-account="${BILLING_ACCOUNT_ID}"

# Verify billing is enabled
gcloud billing projects describe "${PROJECT_ID}"
```

### Set Default Project

```bash
# Set as default project for all gcloud commands
gcloud config set project "${PROJECT_ID}"

# Verify
gcloud config get-value project
```

---

## 4. Enable Required APIs

```bash
# Enable all required APIs (this may take a few minutes)
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  compute.googleapis.com \
  vpcaccess.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  servicenetworking.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  storage.googleapis.com \
  --project="${PROJECT_ID}"

# Verify APIs are enabled
gcloud services list --enabled --project="${PROJECT_ID}"
```

Expected output should include all the services above.

---

## 5. Create Terraform State Bucket

```bash
# Create a GCS bucket for Terraform state
# Bucket names must be globally unique
gcloud storage buckets create "gs://${PROJECT_ID}-terraform-state" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --uniform-bucket-level-access

# Enable versioning for state protection
gcloud storage buckets update "gs://${PROJECT_ID}-terraform-state" \
  --versioning

# Verify bucket was created
gcloud storage buckets describe "gs://${PROJECT_ID}-terraform-state"
```

---

## 6. Create Service Account for GitHub Actions

### Create the Service Account

```bash
# Create the service account
gcloud iam service-accounts create github-actions \
  --project="${PROJECT_ID}" \
  --display-name="GitHub Actions Deployment" \
  --description="Service account for GitHub Actions CI/CD"

# Store the email for later use
export SA_EMAIL="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"
echo "Service Account Email: ${SA_EMAIL}"
```

### Grant Required IAM Roles

```bash
# Cloud Run Admin - deploy and manage Cloud Run services
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin" \
  --condition=None

# Service Account User - act as Cloud Run service accounts
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None

# Artifact Registry Writer - push Docker images
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer" \
  --condition=None

# Artifact Registry Reader - pull Docker images
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.reader" \
  --condition=None

# Cloud SQL Admin - manage database
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.admin" \
  --condition=None

# Secret Manager Admin - manage secrets
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.admin" \
  --condition=None

# Storage Admin - manage Terraform state bucket
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.admin" \
  --condition=None

# Compute Admin - manage load balancer and networking
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/compute.admin" \
  --condition=None

# VPC Access Admin - manage VPC connectors
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/vpcaccess.admin" \
  --condition=None

# Service Networking Admin - manage private service connections
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/servicenetworking.networksAdmin" \
  --condition=None
```

### Verify IAM Bindings

```bash
# List all roles for the service account
gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${SA_EMAIL}" \
  --format="table(bindings.role)"
```

---

## 7. Setup Workload Identity Federation

Workload Identity Federation allows GitHub Actions to authenticate without storing long-lived service account keys.

### Create Workload Identity Pool

```bash
# Create the workload identity pool
gcloud iam workload-identity-pools create "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool" \
  --description="Identity pool for GitHub Actions workflows"

# Get the full pool name
export WORKLOAD_POOL_NAME=$(gcloud iam workload-identity-pools describe "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --format="value(name)")

echo "Workload Pool Name: ${WORKLOAD_POOL_NAME}"
```

### Create OIDC Provider

```bash
# Create the OIDC provider for GitHub
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub OIDC Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Get the full provider name (needed for GitHub Actions)
export WORKLOAD_PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github" \
  --format="value(name)")

echo "Workload Provider Name: ${WORKLOAD_PROVIDER_NAME}"
```

### Allow GitHub Repository to Use Service Account

```bash
# Allow the specific repository to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WORKLOAD_POOL_NAME}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"

# Verify the binding
gcloud iam service-accounts get-iam-policy "${SA_EMAIL}" \
  --project="${PROJECT_ID}"
```

---

## 8. Create Artifact Registry Repository

### Create Repository for Staging

```bash
# Create Docker repository for staging
gcloud artifacts repositories create "nopo-stage-repo" \
  --project="${PROJECT_ID}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Docker images for Nopo staging environment"

# Verify creation
gcloud artifacts repositories describe "nopo-stage-repo" \
  --project="${PROJECT_ID}" \
  --location="${REGION}"
```

### Create Repository for Production

```bash
# Create Docker repository for production
gcloud artifacts repositories create "nopo-prod-repo" \
  --project="${PROJECT_ID}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Docker images for Nopo production environment"

# Verify creation
gcloud artifacts repositories describe "nopo-prod-repo" \
  --project="${PROJECT_ID}" \
  --location="${REGION}"
```

### Configure Docker Authentication

```bash
# Configure Docker to authenticate with Artifact Registry
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# Verify configuration (check ~/.docker/config.json)
cat ~/.docker/config.json | grep -A2 "${REGION}-docker.pkg.dev"
```

---

## 9. Initial Secrets Setup

Create placeholder secrets that Terraform will manage:

```bash
# Generate and store database password for staging
gcloud secrets create "nopo-stage-db-password" \
  --project="${PROJECT_ID}" \
  --replication-policy="automatic"

# Add initial version with generated password
openssl rand -base64 32 | gcloud secrets versions add "nopo-stage-db-password" \
  --project="${PROJECT_ID}" \
  --data-file=-

# Generate and store Django secret key for staging
gcloud secrets create "nopo-stage-django-secret" \
  --project="${PROJECT_ID}" \
  --replication-policy="automatic"

openssl rand -base64 50 | gcloud secrets versions add "nopo-stage-django-secret" \
  --project="${PROJECT_ID}" \
  --data-file=-

# Repeat for production
gcloud secrets create "nopo-prod-db-password" \
  --project="${PROJECT_ID}" \
  --replication-policy="automatic"

openssl rand -base64 32 | gcloud secrets versions add "nopo-prod-db-password" \
  --project="${PROJECT_ID}" \
  --data-file=-

gcloud secrets create "nopo-prod-django-secret" \
  --project="${PROJECT_ID}" \
  --replication-policy="automatic"

openssl rand -base64 50 | gcloud secrets versions add "nopo-prod-django-secret" \
  --project="${PROJECT_ID}" \
  --data-file=-

# List all secrets
gcloud secrets list --project="${PROJECT_ID}"
```

---

## 10. Verify Setup

### Print Configuration Summary

```bash
cat << EOF

============================================================
GCP SETUP COMPLETE - CONFIGURATION SUMMARY
============================================================

PROJECT CONFIGURATION:
  Project ID:      ${PROJECT_ID}
  Region:          ${REGION}
  Domain:          ${DOMAIN}

SERVICE ACCOUNT:
  Email:           ${SA_EMAIL}

WORKLOAD IDENTITY (for GitHub Actions):
  Provider:        ${WORKLOAD_PROVIDER_NAME}

ARTIFACT REGISTRY:
  Stage Registry:  ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-stage-repo
  Prod Registry:   ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-prod-repo

TERRAFORM STATE:
  Bucket:          gs://${PROJECT_ID}-terraform-state

============================================================
GITHUB REPOSITORY CONFIGURATION
============================================================

Add these as REPOSITORY VARIABLES in GitHub:
(Settings → Secrets and variables → Actions → Variables)

  GCP_PROJECT_ID:         ${PROJECT_ID}
  GCP_ARTIFACT_REGISTRY:  ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-stage-repo
  TERRAFORM_STATE_BUCKET: ${PROJECT_ID}-terraform-state
  DOMAIN:                 ${DOMAIN}

Add these as REPOSITORY SECRETS in GitHub:
(Settings → Secrets and variables → Actions → Secrets)

  GCP_WORKLOAD_IDENTITY_PROVIDER: ${WORKLOAD_PROVIDER_NAME}
  GCP_SERVICE_ACCOUNT:            ${SA_EMAIL}

============================================================
EOF
```

### Test Service Account Authentication (Optional)

```bash
# Create a temporary key for testing (delete after testing)
gcloud iam service-accounts keys create /tmp/sa-key.json \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}"

# Activate the service account
gcloud auth activate-service-account --key-file=/tmp/sa-key.json

# Test permissions
gcloud run services list --region="${REGION}" --project="${PROJECT_ID}"
gcloud artifacts repositories list --location="${REGION}" --project="${PROJECT_ID}"

# Switch back to your user account
gcloud auth login

# DELETE THE KEY - don't leave service account keys around
rm /tmp/sa-key.json

# Also delete from GCP (list keys first)
gcloud iam service-accounts keys list --iam-account="${SA_EMAIL}" --project="${PROJECT_ID}"
# Delete any test keys (keep the one ending in "managed by Google")
# gcloud iam service-accounts keys delete KEY_ID --iam-account="${SA_EMAIL}" --project="${PROJECT_ID}"
```

---

## 11. Next Steps

### 1. Configure GitHub Repository

Add the variables and secrets printed above to your GitHub repository settings.

### 2. Run Initial Terraform Deployment

```bash
# Navigate to staging environment
cd infrastructure/terraform/environments/stage

# Initialize Terraform with GCS backend
terraform init \
  -backend-config="bucket=${PROJECT_ID}-terraform-state" \
  -backend-config="prefix=nopo/stage"

# Create tfvars file
cat > terraform.tfvars << EOF
project_id       = "${PROJECT_ID}"
region           = "${REGION}"
domain           = "${DOMAIN}"
subdomain_prefix = "stage"

# Use placeholder images for initial deployment
backend_image = "gcr.io/cloudrun/hello"
web_image     = "gcr.io/cloudrun/hello"
EOF

# Plan and apply
terraform plan
terraform apply
```

### 3. Configure DNS

After Terraform completes, configure your DNS:

```bash
# Get the load balancer IP
terraform output load_balancer_ip

# Add DNS record:
# Type: A
# Name: stage (or @ for apex)
# Value: <load_balancer_ip>
```

### 4. Trigger First Deployment

Push a commit to your main branch to trigger the GitHub Actions deployment workflow.

---

## Troubleshooting

### "Permission denied" on gcloud commands

```bash
# Re-authenticate
gcloud auth login

# Verify you're using the right project
gcloud config get-value project
```

### "Billing account not found"

```bash
# List available billing accounts
gcloud billing accounts list

# Make sure you have Billing Account Administrator role
```

### "API not enabled"

```bash
# Re-run the API enable command
gcloud services enable SERVICE_NAME.googleapis.com --project="${PROJECT_ID}"
```

### "Workload Identity not working"

```bash
# Verify the pool exists
gcloud iam workload-identity-pools list --location="global" --project="${PROJECT_ID}"

# Verify the provider exists
gcloud iam workload-identity-pools providers list \
  --workload-identity-pool="github" \
  --location="global" \
  --project="${PROJECT_ID}"

# Verify the IAM binding
gcloud iam service-accounts get-iam-policy "${SA_EMAIL}" --project="${PROJECT_ID}"
```

---

## Save Your Configuration

Save your configuration for future reference:

```bash
# Save to a secure location (not in git!)
cat > ~/gcp-nopo-credentials.txt << EOF
Project ID: ${PROJECT_ID}
Region: ${REGION}
Service Account: ${SA_EMAIL}
Workload Identity Provider: ${WORKLOAD_PROVIDER_NAME}
Terraform State Bucket: ${PROJECT_ID}-terraform-state
Artifact Registry (Stage): ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-stage-repo
Artifact Registry (Prod): ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-prod-repo
EOF

chmod 600 ~/gcp-nopo-credentials.txt
echo "Configuration saved to ~/gcp-nopo-credentials.txt"
```

---

## Cleanup (If Needed)

To completely remove all resources:

```bash
# Delete the project (this deletes EVERYTHING)
gcloud projects delete "${PROJECT_ID}"

# Or delete individual resources:
# gcloud artifacts repositories delete nopo-stage-repo --location="${REGION}" --project="${PROJECT_ID}"
# gcloud iam workload-identity-pools delete github --location="global" --project="${PROJECT_ID}"
# gcloud iam service-accounts delete "${SA_EMAIL}" --project="${PROJECT_ID}"
# gcloud storage rm -r "gs://${PROJECT_ID}-terraform-state"
```
