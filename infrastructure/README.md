# Infrastructure - Google Cloud Platform

This directory contains Terraform configurations for deploying the application to Google Cloud Platform (GCP).

## Quick Start: Automated Setup

Run the interactive setup script to configure everything automatically:

```bash
./infrastructure/scripts/setup-gcp.sh
```

The script will prompt for your project details and run all required GCP commands.

> **New to GCP?** See [GCP_CLI_SETUP.md](./GCP_CLI_SETUP.md) for manual step-by-step instructions including CLI installation.

## Architecture Overview

```text
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                    Google Cloud Platform                    │
                                    │                                                             │
    Internet                        │  ┌─────────────────────────────────────────────────────┐   │
        │                           │  │              Global Load Balancer                    │   │
        │                           │  │         (HTTPS with managed SSL cert)               │   │
        ▼                           │  └───────────────────┬─────────────────────────────────┘   │
   ┌─────────┐                      │                      │                                     │
   │  Users  │ ─────────────────────┼──────────────────────┤                                     │
   └─────────┘                      │                      │                                     │
                                    │         ┌────────────┴────────────┐                        │
                                    │         │     URL Map Routing     │                        │
                                    │         │  /api/* → Backend       │                        │
                                    │         │  /admin/* → Backend     │                        │
                                    │         │  /static/* → Backend    │                        │
                                    │         │  /* → Web               │                        │
                                    │         └───────┬─────────┬───────┘                        │
                                    │                 │         │                                │
                                    │    ┌────────────┘         └────────────┐                   │
                                    │    ▼                                   ▼                   │
                                    │  ┌───────────────────┐   ┌───────────────────┐            │
                                    │  │   Cloud Run       │   │   Cloud Run       │            │
                                    │  │   (Backend)       │   │   (Web)           │            │
                                    │  │   Django + DRF    │   │   React Router    │            │
                                    │  └─────────┬─────────┘   └───────────────────┘            │
                                    │            │                                               │
                                    │            │ VPC Connector                                 │
                                    │            ▼                                               │
                                    │  ┌───────────────────┐                                     │
                                    │  │   Cloud SQL       │                                     │
                                    │  │   (PostgreSQL)    │                                     │
                                    │  │   Private IP      │                                     │
                                    │  └───────────────────┘                                     │
                                    │                                                             │
                                    └─────────────────────────────────────────────────────────────┘
```

## Components

| Component | GCP Service | Description |
|-----------|-------------|-------------|
| Backend | Cloud Run | Django application with REST API |
| Web | Cloud Run | React Router frontend |
| Database | Cloud SQL | PostgreSQL 16 with private IP |
| Load Balancer | Cloud Load Balancing | Global HTTPS LB with managed SSL |
| Networking | VPC | Private network with VPC connector |
| Secrets | Secret Manager | DB password, Django secret key |
| Container Registry | Artifact Registry | Docker image storage |

## Prerequisites

- Google Cloud Platform account with billing enabled
- `gcloud` CLI installed and authenticated
- Terraform >= 1.5.0
- A domain name with access to DNS settings

## Documentation

| Document | Description |
|----------|-------------|
| [README.md](./README.md) | This file - quick start guide |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **Detailed architecture** - In-depth explanation of all components |
| [ADDING_SERVICES.md](./ADDING_SERVICES.md) | **Adding new services** - How to add/remove services dynamically |
| [GCP_CLI_SETUP.md](./GCP_CLI_SETUP.md) | **Start here** - Complete CLI setup guide including gcloud installation |
| [GCP_GITHUB_SETUP.md](./GCP_GITHUB_SETUP.md) | GitHub Actions integration with Workload Identity Federation |

## Quick Start

### 1. Initial GCP Project Setup

```bash
# Set your project ID - REPLACE {YOUR_PROJECT_ID} with your actual value
export PROJECT_ID="{YOUR_PROJECT_ID}"   # e.g., "mycompany-nopo"
export REGION="us-central1"

# Create project (if needed)
gcloud projects create $PROJECT_ID --name="Nopo"

# Set the project
gcloud config set project $PROJECT_ID

# Enable billing (required - do this in Console)
# https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID

# Enable required APIs
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
  iamcredentials.googleapis.com
```

### 2. Create Terraform State Bucket

```bash
# Create a GCS bucket for Terraform state
gsutil mb -l $REGION gs://${PROJECT_ID}-terraform-state

# Enable versioning
gsutil versioning set on gs://${PROJECT_ID}-terraform-state
```

### 3. Deploy Infrastructure

```bash
cd infrastructure/terraform/environments/stage

# Initialize Terraform
terraform init \
  -backend-config="bucket=${PROJECT_ID}-terraform-state" \
  -backend-config="prefix=nopo/stage"

# Create terraform.tfvars
cat > terraform.tfvars <<EOF
project_id       = "${PROJECT_ID}"
region           = "${REGION}"
domain           = "your-domain.com"
subdomain_prefix = "stage"

# Initial placeholder images (will be updated by CI/CD)
backend_image = "gcr.io/cloudrun/hello"
web_image     = "gcr.io/cloudrun/hello"
EOF

# Plan and apply
terraform plan
terraform apply
```

### 4. Configure DNS

After Terraform applies, it will output the load balancer IP address. Configure your DNS:

```text
Type: A
Name: stage (or @ for apex domain)
Value: <load_balancer_ip from terraform output>
TTL: 300
```

The SSL certificate will be automatically provisioned once DNS propagates (can take up to 24 hours).

## GitHub Actions Setup

For automated deployments from GitHub Actions, you need to set up Workload Identity Federation (recommended) or a service account key.

See [GCP_GITHUB_SETUP.md](./GCP_GITHUB_SETUP.md) for detailed instructions.

## Directory Structure

```text
infrastructure/
├── README.md                    # This file
├── ARCHITECTURE.md             # Detailed architecture docs
├── ADDING_SERVICES.md          # Guide for adding new services
├── GCP_CLI_SETUP.md            # Manual CLI setup guide
├── GCP_GITHUB_SETUP.md         # GitHub Actions setup guide
├── scripts/
│   ├── setup-gcp.sh            # Interactive GCP setup script
│   └── sync-services.sh        # Dynamic service discovery for Terraform
└── terraform/
    ├── main.tf                  # Root module
    ├── variables.tf             # Input variables
    ├── outputs.tf               # Output values
    ├── versions.tf              # Provider versions
    ├── modules/
    │   ├── artifact-registry/   # Container image storage
    │   ├── cloudsql/           # PostgreSQL database
    │   ├── cloudrun/           # Serverless containers
    │   ├── loadbalancer/       # HTTPS load balancer
    │   ├── networking/         # VPC and connectivity
    │   └── secrets/            # Secret Manager
    └── environments/
        ├── stage/              # Staging environment
        │   ├── main.tf
        │   ├── variables.tf
        │   ├── outputs.tf
        │   └── terraform.tfvars.example
        └── prod/               # Production environment
            ├── main.tf
            ├── variables.tf
            ├── outputs.tf
            └── terraform.tfvars.example
```

## Cost Estimation

Estimated monthly costs (us-central1, minimal usage):

| Resource | Stage | Production |
|----------|-------|------------|
| Cloud Run (scale-to-zero) | ~$0-10 | ~$20-50 |
| Cloud SQL (db-f1-micro / db-custom-1-3840) | ~$8 | ~$50 |
| Load Balancer | ~$18 | ~$18 |
| VPC Connector | ~$7 | ~$7 |
| Secret Manager | ~$0 | ~$0 |
| Artifact Registry | ~$0-5 | ~$0-5 |
| **Total (idle)** | **~$35** | **~$100** |

*Note: Costs vary based on actual usage. Cloud Run scales to zero when not in use.*

## Scaling to Kubernetes

This setup is designed to be easily migrated to Google Kubernetes Engine (GKE) if needed:

1. The VPC and networking are already Kubernetes-compatible
2. Container images are stored in Artifact Registry
3. Cloud SQL can be connected via Cloud SQL Proxy sidecar
4. Secrets are managed via Secret Manager (use External Secrets Operator)

To migrate:

1. Create a GKE cluster in the existing VPC
2. Deploy applications as Kubernetes Deployments/Services
3. Use GKE Ingress for load balancing (or keep existing LB)
4. Connect to Cloud SQL using Cloud SQL Auth Proxy sidecar

## Troubleshooting

### SSL Certificate Not Provisioning

1. Verify DNS is correctly configured: `dig +short your-domain.com`
2. Check certificate status in Cloud Console
3. Certificate provisioning can take up to 24 hours

### Cloud Run Services Not Starting

1. Check Cloud Run logs: `gcloud run services logs read SERVICE_NAME --region=$REGION`
2. Verify image exists in Artifact Registry
3. Check service account permissions

### Database Connection Issues

1. Verify VPC connector is working
2. Check Cloud SQL instance is running
3. Verify password in Secret Manager
4. Check Cloud Run service account has `cloudsql.client` role

### Terraform State Issues

1. Ensure state bucket exists and is accessible
2. Check IAM permissions for state bucket
3. Use `terraform init -reconfigure` to fix backend issues

## Security Considerations

1. **Network Isolation**: Cloud SQL uses private IP only
2. **Secrets Management**: All secrets in Secret Manager
3. **IAM**: Minimal permissions via dedicated service accounts
4. **HTTPS Only**: Load balancer forces HTTPS
5. **Container Security**: Images scanned in Artifact Registry
