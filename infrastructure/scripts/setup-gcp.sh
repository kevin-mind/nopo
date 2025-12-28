#!/usr/bin/env bash
#
# setup-gcp.sh - Interactive GCP infrastructure setup script
#
# This script automates the complete setup of GCP infrastructure for the Nopo application.
# It will prompt for required information and run all necessary gcloud commands.
#
# Prerequisites:
#   - Google Cloud SDK (gcloud) installed
#   - A Google Cloud billing account
#
# Usage:
#   ./setup-gcp.sh
#
# The script will:
#   1. Authenticate with GCP (if needed)
#   2. Create a new project (or use existing)
#   3. Enable required APIs
#   4. Create Terraform state bucket
#   5. Create service account for GitHub Actions
#   6. Set up Workload Identity Federation
#   7. Create Artifact Registry
#   8. Optionally configure Cloudflare DNS
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Logging functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_step() { echo -e "\n${BLUE}${BOLD}==> $1${NC}"; }
log_substep() { echo -e "${CYAN}  -> $1${NC}"; }

# Prompt for input with default value
prompt() {
    local varname="$1"
    local prompt_text="$2"
    local default="${3:-}"
    local value
    
    if [[ -n "$default" ]]; then
        read -rp "$(echo -e "${BOLD}$prompt_text${NC} [$default]: ")" value
        value="${value:-$default}"
    else
        read -rp "$(echo -e "${BOLD}$prompt_text${NC}: ")" value
    fi
    
    eval "$varname=\"$value\""
}

# Prompt for yes/no
confirm() {
    local prompt_text="$1"
    local default="${2:-y}"
    local yn
    
    if [[ "$default" == "y" ]]; then
        read -rp "$(echo -e "${BOLD}$prompt_text${NC} [Y/n]: ")" yn
        yn="${yn:-y}"
    else
        read -rp "$(echo -e "${BOLD}$prompt_text${NC} [y/N]: ")" yn
        yn="${yn:-n}"
    fi
    
    [[ "$yn" =~ ^[Yy] ]]
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites"
    
    if ! command_exists gcloud; then
        log_error "gcloud CLI is not installed."
        echo ""
        echo "Install it from: https://cloud.google.com/sdk/docs/install"
        echo ""
        echo "Quick install commands:"
        echo "  macOS:  brew install --cask google-cloud-sdk"
        echo "  Linux:  curl https://sdk.cloud.google.com | bash"
        exit 1
    fi
    log_substep "gcloud CLI found: $(gcloud version 2>/dev/null | head -1)"
    
    if ! command_exists jq; then
        log_error "jq is not installed."
        echo ""
        echo "Install it:"
        echo "  macOS:  brew install jq"
        echo "  Linux:  apt-get install jq"
        exit 1
    fi
    log_substep "jq found"
    
    if ! command_exists terraform; then
        log_warn "Terraform is not installed. You'll need it to deploy infrastructure."
        echo "  Install from: https://developer.hashicorp.com/terraform/install"
    else
        log_substep "Terraform found: $(terraform version | head -1)"
    fi
}

# Authenticate with GCP
authenticate_gcp() {
    log_step "Authenticating with Google Cloud"
    
    # Check if already authenticated
    if gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>/dev/null | grep -q "@"; then
        local current_account=$(gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>/dev/null | head -1)
        log_substep "Already authenticated as: $current_account"
        
        if ! confirm "Continue with this account?"; then
            log_substep "Running gcloud auth login..."
            gcloud auth login
        fi
    else
        log_substep "No active authentication found. Running gcloud auth login..."
        gcloud auth login
    fi
    
    # Set up application default credentials for Terraform
    if [[ ! -f "$HOME/.config/gcloud/application_default_credentials.json" ]]; then
        log_substep "Setting up application default credentials for Terraform..."
        gcloud auth application-default login
    else
        log_substep "Application default credentials already exist"
    fi
}

# Get or create project
setup_project() {
    log_step "Setting up GCP Project"
    
    prompt PROJECT_ID "Enter GCP Project ID (must be globally unique)"
    
    # Check if project exists
    if gcloud projects describe "$PROJECT_ID" &>/dev/null; then
        log_substep "Project '$PROJECT_ID' already exists"
        if ! confirm "Use this existing project?"; then
            log_error "Please run the script again with a different project ID"
            exit 1
        fi
    else
        log_substep "Creating project '$PROJECT_ID'..."
        prompt PROJECT_NAME "Enter project display name" "Nopo Application"
        gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
        log_substep "Project created successfully"
    fi
    
    # Set as current project
    gcloud config set project "$PROJECT_ID"
    log_substep "Set '$PROJECT_ID' as current project"
}

# Link billing account
setup_billing() {
    log_step "Setting up Billing"
    
    # Check if billing is already enabled
    if gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled)" 2>/dev/null | grep -q "True"; then
        log_substep "Billing is already enabled for this project"
        return
    fi
    
    # List available billing accounts
    echo ""
    echo "Available billing accounts:"
    gcloud billing accounts list --format="table(name, displayName, open)"
    echo ""
    
    prompt BILLING_ACCOUNT_ID "Enter Billing Account ID (e.g., 0X0X0X-0X0X0X-0X0X0X)"
    
    log_substep "Linking billing account to project..."
    gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"
    log_substep "Billing enabled successfully"
}

# Enable required APIs
enable_apis() {
    log_step "Enabling Required APIs"
    
    local apis=(
        "run.googleapis.com"
        "sqladmin.googleapis.com"
        "compute.googleapis.com"
        "vpcaccess.googleapis.com"
        "secretmanager.googleapis.com"
        "artifactregistry.googleapis.com"
        "servicenetworking.googleapis.com"
        "cloudresourcemanager.googleapis.com"
        "iam.googleapis.com"
        "iamcredentials.googleapis.com"
        "storage.googleapis.com"
    )
    
    log_substep "Enabling ${#apis[@]} APIs (this may take a few minutes)..."
    gcloud services enable "${apis[@]}" --project="$PROJECT_ID"
    log_substep "All APIs enabled successfully"
}

# Create Terraform state bucket
create_state_bucket() {
    log_step "Creating Terraform State Bucket"
    
    local bucket_name="${PROJECT_ID}-terraform-state"
    
    if gsutil ls -b "gs://${bucket_name}" &>/dev/null; then
        log_substep "Bucket 'gs://${bucket_name}' already exists"
    else
        log_substep "Creating bucket 'gs://${bucket_name}'..."
        gcloud storage buckets create "gs://${bucket_name}" \
            --project="$PROJECT_ID" \
            --location="$REGION" \
            --uniform-bucket-level-access
        
        log_substep "Enabling versioning..."
        gcloud storage buckets update "gs://${bucket_name}" --versioning
        log_substep "Bucket created successfully"
    fi
    
    TERRAFORM_STATE_BUCKET="$bucket_name"
}

# Create service account
create_service_account() {
    log_step "Creating Service Account for GitHub Actions"
    
    SA_NAME="github-actions"
    SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
    
    if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" &>/dev/null; then
        log_substep "Service account '$SA_EMAIL' already exists"
    else
        log_substep "Creating service account..."
        gcloud iam service-accounts create "$SA_NAME" \
            --project="$PROJECT_ID" \
            --display-name="GitHub Actions Deployment" \
            --description="Service account for GitHub Actions CI/CD"
    fi
    
    # Grant required roles
    log_substep "Granting IAM roles..."
    local roles=(
        "roles/run.admin"
        "roles/iam.serviceAccountUser"
        "roles/artifactregistry.writer"
        "roles/artifactregistry.reader"
        "roles/cloudsql.admin"
        "roles/secretmanager.admin"
        "roles/storage.admin"
        "roles/compute.admin"
        "roles/vpcaccess.admin"
        "roles/servicenetworking.networksAdmin"
    )
    
    for role in "${roles[@]}"; do
        log_substep "  Granting $role..."
        gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="serviceAccount:${SA_EMAIL}" \
            --role="$role" \
            --condition=None \
            --quiet &>/dev/null || true
    done
    
    log_substep "All roles granted successfully"
}

# Setup Workload Identity Federation
setup_workload_identity() {
    log_step "Setting up Workload Identity Federation"
    
    # Create workload identity pool
    if gcloud iam workload-identity-pools describe "github" --location="global" --project="$PROJECT_ID" &>/dev/null; then
        log_substep "Workload identity pool 'github' already exists"
    else
        log_substep "Creating workload identity pool..."
        gcloud iam workload-identity-pools create "github" \
            --project="$PROJECT_ID" \
            --location="global" \
            --display-name="GitHub Actions Pool" \
            --description="Identity pool for GitHub Actions workflows"
    fi
    
    # Get pool name
    WORKLOAD_POOL_NAME=$(gcloud iam workload-identity-pools describe "github" \
        --project="$PROJECT_ID" \
        --location="global" \
        --format="value(name)")
    
    # Create OIDC provider
    if gcloud iam workload-identity-pools providers describe "github-provider" \
        --location="global" \
        --workload-identity-pool="github" \
        --project="$PROJECT_ID" &>/dev/null; then
        log_substep "OIDC provider 'github-provider' already exists"
    else
        log_substep "Creating OIDC provider..."
        gcloud iam workload-identity-pools providers create-oidc "github-provider" \
            --project="$PROJECT_ID" \
            --location="global" \
            --workload-identity-pool="github" \
            --display-name="GitHub OIDC Provider" \
            --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
            --attribute-condition="assertion.repository_owner == '${GITHUB_ORG}'" \
            --issuer-uri="https://token.actions.githubusercontent.com"
    fi
    
    # Get provider name
    WORKLOAD_PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe "github-provider" \
        --project="$PROJECT_ID" \
        --location="global" \
        --workload-identity-pool="github" \
        --format="value(name)")
    
    # Allow GitHub repo to use service account
    log_substep "Allowing GitHub repository to impersonate service account..."
    gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
        --project="$PROJECT_ID" \
        --role="roles/iam.workloadIdentityUser" \
        --member="principalSet://iam.googleapis.com/${WORKLOAD_POOL_NAME}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}" \
        --quiet &>/dev/null || true
    
    log_substep "Workload Identity Federation configured successfully"
}

# Create Artifact Registry
create_artifact_registry() {
    log_step "Creating Artifact Registry"
    
    local repo_name="nopo"
    
    if gcloud artifacts repositories describe "$repo_name" \
        --location="$REGION" \
        --project="$PROJECT_ID" &>/dev/null; then
        log_substep "Repository '$repo_name' already exists"
    else
        log_substep "Creating Docker repository '$repo_name'..."
        gcloud artifacts repositories create "$repo_name" \
            --project="$PROJECT_ID" \
            --repository-format=docker \
            --location="$REGION" \
            --description="Docker images for Nopo application"
    fi
    
    ARTIFACT_REGISTRY_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${repo_name}"
    log_substep "Artifact Registry URL: $ARTIFACT_REGISTRY_URL"
}

# Setup Cloudflare DNS (optional)
setup_cloudflare() {
    log_step "Cloudflare DNS Setup (Optional)"
    
    if ! confirm "Do you want to configure Cloudflare DNS?" "n"; then
        log_substep "Skipping Cloudflare setup"
        return
    fi
    
    # Check if flarectl is installed
    if ! command_exists flarectl; then
        log_substep "Installing Cloudflare CLI (flarectl)..."
        if command_exists brew; then
            brew install cloudflare/cloudflare/flarectl
        elif command_exists go; then
            go install github.com/cloudflare/cloudflare-go/cmd/flarectl@latest
        else
            log_warn "Cannot auto-install flarectl. Please install manually:"
            echo "  brew install cloudflare/cloudflare/flarectl"
            echo "  OR"
            echo "  go install github.com/cloudflare/cloudflare-go/cmd/flarectl@latest"
            return
        fi
    fi
    
    prompt CF_API_TOKEN "Enter Cloudflare API Token"
    export CF_API_TOKEN
    
    log_substep "Cloudflare CLI configured"
    log_substep "You can update DNS after Terraform creates the load balancer:"
    echo ""
    echo "  LB_IP=\$(terraform output -raw load_balancer_ip)"
    echo "  flarectl dns create-or-update --zone ${DOMAIN} --name stage --type A --content \${LB_IP} --ttl 300"
    echo ""
}

# Print summary
print_summary() {
    log_step "Setup Complete!"
    
    echo ""
    echo -e "${BOLD}==================================================${NC}"
    echo -e "${BOLD}           GCP SETUP SUMMARY${NC}"
    echo -e "${BOLD}==================================================${NC}"
    echo ""
    echo -e "${CYAN}Project Configuration:${NC}"
    echo "  Project ID:        $PROJECT_ID"
    echo "  Region:            $REGION"
    echo "  Domain:            $DOMAIN"
    echo ""
    echo -e "${CYAN}Service Account:${NC}"
    echo "  Email:             $SA_EMAIL"
    echo ""
    echo -e "${CYAN}Workload Identity:${NC}"
    echo "  Provider:          $WORKLOAD_PROVIDER_NAME"
    echo ""
    echo -e "${CYAN}Artifact Registry:${NC}"
    echo "  URL:               $ARTIFACT_REGISTRY_URL"
    echo ""
    echo -e "${CYAN}Terraform State:${NC}"
    echo "  Bucket:            $TERRAFORM_STATE_BUCKET"
    echo ""
    echo -e "${BOLD}==================================================${NC}"
    echo -e "${BOLD}           GITHUB REPOSITORY SETTINGS${NC}"
    echo -e "${BOLD}==================================================${NC}"
    echo ""
    echo -e "${CYAN}Repository Variables:${NC}"
    echo -e "  (Settings → Secrets and variables → Actions → Variables)"
    echo ""
    echo "  GCP_PROJECT_ID          = $PROJECT_ID"
    echo "  GCP_ARTIFACT_REGISTRY   = $ARTIFACT_REGISTRY_URL"
    echo "  TERRAFORM_STATE_BUCKET  = $TERRAFORM_STATE_BUCKET"
    echo "  DOMAIN                  = $DOMAIN"
    echo ""
    echo -e "${CYAN}Repository Secrets:${NC}"
    echo -e "  (Settings → Secrets and variables → Actions → Secrets)"
    echo ""
    echo "  GCP_WORKLOAD_IDENTITY_PROVIDER = $WORKLOAD_PROVIDER_NAME"
    echo "  GCP_SERVICE_ACCOUNT            = $SA_EMAIL"
    echo ""
    echo -e "${BOLD}==================================================${NC}"
    echo -e "${BOLD}           NEXT STEPS${NC}"
    echo -e "${BOLD}==================================================${NC}"
    echo ""
    echo "1. Add the above variables and secrets to your GitHub repository"
    echo ""
    echo "2. Run Terraform to create infrastructure:"
    echo "   cd infrastructure/terraform/environments/stage"
    echo "   terraform init \\"
    echo "     -backend-config=\"bucket=${TERRAFORM_STATE_BUCKET}\" \\"
    echo "     -backend-config=\"prefix=nopo/stage\""
    echo ""
    echo "3. Create terraform.tfvars:"
    echo "   cat > terraform.tfvars << EOF"
    echo "   project_id       = \"$PROJECT_ID\""
    echo "   region           = \"$REGION\""
    echo "   domain           = \"$DOMAIN\""
    echo "   subdomain_prefix = \"stage\""
    echo "   backend_image    = \"gcr.io/cloudrun/hello\""
    echo "   web_image        = \"gcr.io/cloudrun/hello\""
    echo "   EOF"
    echo ""
    echo "4. Apply Terraform:"
    echo "   terraform apply"
    echo ""
    echo "5. Configure DNS (after Terraform completes):"
    echo "   Point ${SUBDOMAIN_PREFIX:+${SUBDOMAIN_PREFIX}.}${DOMAIN} to the load balancer IP"
    echo ""
    
    # Save configuration to file
    local config_file="$HOME/.nopo-gcp-config"
    cat > "$config_file" << EOF
# Nopo GCP Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

export PROJECT_ID="$PROJECT_ID"
export REGION="$REGION"
export DOMAIN="$DOMAIN"
export GITHUB_ORG="$GITHUB_ORG"
export GITHUB_REPO="$GITHUB_REPO"
export SA_EMAIL="$SA_EMAIL"
export WORKLOAD_PROVIDER_NAME="$WORKLOAD_PROVIDER_NAME"
export ARTIFACT_REGISTRY_URL="$ARTIFACT_REGISTRY_URL"
export TERRAFORM_STATE_BUCKET="$TERRAFORM_STATE_BUCKET"
EOF
    chmod 600 "$config_file"
    
    echo -e "${GREEN}Configuration saved to: $config_file${NC}"
    echo "Load it with: source $config_file"
    echo ""
}

# Main function
main() {
    echo ""
    echo -e "${BOLD}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║          Nopo GCP Infrastructure Setup Script             ║${NC}"
    echo -e "${BOLD}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    check_prerequisites
    
    # Gather initial information
    log_step "Gathering Configuration"
    
    prompt REGION "Enter GCP region" "us-central1"
    prompt GITHUB_ORG "Enter GitHub organization/username"
    prompt GITHUB_REPO "Enter GitHub repository name"
    prompt DOMAIN "Enter your domain name (e.g., example.com)"
    prompt SUBDOMAIN_PREFIX "Enter subdomain prefix for staging (leave empty for apex)" "stage"
    
    echo ""
    echo -e "${CYAN}Configuration Summary:${NC}"
    echo "  Region:       $REGION"
    echo "  GitHub:       $GITHUB_ORG/$GITHUB_REPO"
    echo "  Domain:       ${SUBDOMAIN_PREFIX:+${SUBDOMAIN_PREFIX}.}${DOMAIN}"
    echo ""
    
    if ! confirm "Proceed with this configuration?"; then
        log_error "Setup cancelled"
        exit 1
    fi
    
    # Run setup steps
    authenticate_gcp
    setup_project
    setup_billing
    enable_apis
    create_state_bucket
    create_service_account
    setup_workload_identity
    create_artifact_registry
    setup_cloudflare
    
    print_summary
}

# Run main
main "$@"
