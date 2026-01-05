#!/usr/bin/env bash
#
# setup-app-infrastructure.sh - Create infrastructure required before deployment
#
# This script creates the Artifact Registry repositories, GCS buckets, and
# backend buckets required for deployment. These must exist before CI/CD runs.
#
# Resources created per environment:
#   - Artifact Registry repository (nopo-{env}-repo) for Docker images
#   - GCS bucket (nopo-{env}-static) for static assets
#   - Backend bucket (nopo-{env}-static-backend) for load balancer routing
#
# Usage:
#   ./setup-app-infrastructure.sh [options]
#
# Options:
#   --project-id      GCP project ID (required, or set GCP_PROJECT_ID env var)
#   --region          GCP region (default: us-central1)
#   --environment     Environment name: stage, prod (default: both)
#   --domain          Domain for CORS origins (required, or set DOMAIN env var)
#   --enable-cdn      Enable CDN for prod (default: true)
#   --dry-run         Show what would be created without creating
#   --help            Show this help message
#
# Environment Variables:
#   GCP_PROJECT_ID    GCP project ID
#   DOMAIN            Domain name for CORS
#   GCP_REGION        GCP region (default: us-central1)
#
# Examples:
#   ./setup-app-infrastructure.sh --project-id=my-project --domain=example.com
#   ./setup-app-infrastructure.sh --environment=stage --dry-run
#   GCP_PROJECT_ID=my-project DOMAIN=example.com ./setup-app-infrastructure.sh
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
log_dry() { echo -e "${YELLOW}[DRY-RUN]${NC} Would: $1"; }

# Default values
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-us-central1}"
DOMAIN="${DOMAIN:-}"
ENVIRONMENT=""
ENABLE_CDN="true"
DRY_RUN="false"

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --project-id=*)
                PROJECT_ID="${1#*=}"
                shift
                ;;
            --region=*)
                REGION="${1#*=}"
                shift
                ;;
            --environment=*)
                ENVIRONMENT="${1#*=}"
                shift
                ;;
            --domain=*)
                DOMAIN="${1#*=}"
                shift
                ;;
            --enable-cdn=*)
                ENABLE_CDN="${1#*=}"
                shift
                ;;
            --dry-run)
                DRY_RUN="true"
                shift
                ;;
            --help|-h)
                head -38 "$0" | tail -35
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
}

# Validate required parameters
validate_params() {
    local errors=0

    if [[ -z "$PROJECT_ID" ]]; then
        log_error "Project ID is required. Use --project-id=<id> or set GCP_PROJECT_ID"
        errors=$((errors + 1))
    fi

    if [[ -z "$DOMAIN" ]]; then
        log_error "Domain is required. Use --domain=<domain> or set DOMAIN"
        errors=$((errors + 1))
    fi

    if [[ -n "$ENVIRONMENT" && "$ENVIRONMENT" != "stage" && "$ENVIRONMENT" != "prod" ]]; then
        log_error "Environment must be 'stage' or 'prod'"
        errors=$((errors + 1))
    fi

    if [[ $errors -gt 0 ]]; then
        echo ""
        echo "Run with --help for usage information"
        exit 1
    fi
}

# Check prerequisites
check_prerequisites() {
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI is not installed"
        echo "Install from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi

    # Verify authentication
    if ! gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>/dev/null | grep -q "@"; then
        log_error "Not authenticated with gcloud. Run: gcloud auth login"
        exit 1
    fi

    # Verify project access
    if ! gcloud projects describe "$PROJECT_ID" &>/dev/null; then
        log_error "Cannot access project '$PROJECT_ID'. Check project ID and permissions."
        exit 1
    fi
}

# Create Artifact Registry repository
create_artifact_registry() {
    local env="$1"
    local repo_name="nopo-${env}-repo"

    log_substep "Creating Artifact Registry: ${repo_name}"

    if gcloud artifacts repositories describe "$repo_name" \
        --project="$PROJECT_ID" \
        --location="$REGION" &>/dev/null; then
        log_substep "Repository already exists: ${repo_name}"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry "Create Artifact Registry repository ${repo_name}"
        log_dry "Grant public read access"
        return 0
    fi

    # Create the repository
    gcloud artifacts repositories create "$repo_name" \
        --project="$PROJECT_ID" \
        --location="$REGION" \
        --repository-format=docker \
        --description="Docker images for nopo ${env} environment" \
        --labels="environment=${env},managed_by=script,project=nopo"

    # Grant public read access (for pulling images)
    gcloud artifacts repositories add-iam-policy-binding "$repo_name" \
        --project="$PROJECT_ID" \
        --location="$REGION" \
        --member="allUsers" \
        --role="roles/artifactregistry.reader"

    log_substep "Repository created: ${repo_name}"
}

# Create storage bucket
create_storage_bucket() {
    local env="$1"
    local bucket_name="nopo-${env}-static"
    local subdomain="${env}"
    local cors_origin="https://${subdomain}.${DOMAIN}"

    log_substep "Creating storage bucket: gs://${bucket_name}"

    if gsutil ls -b "gs://${bucket_name}" &>/dev/null; then
        log_substep "Bucket already exists: gs://${bucket_name}"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry "Create bucket gs://${bucket_name} in ${REGION}"
        log_dry "Set CORS origin: ${cors_origin}"
        log_dry "Enable versioning"
        log_dry "Set lifecycle rule: delete after 3 newer versions"
        log_dry "Grant public read access"
        return 0
    fi

    # Create bucket
    gcloud storage buckets create "gs://${bucket_name}" \
        --project="$PROJECT_ID" \
        --location="$REGION" \
        --uniform-bucket-level-access

    # Enable versioning
    gcloud storage buckets update "gs://${bucket_name}" --versioning

    # Set CORS configuration
    local cors_config=$(cat <<EOF
[
  {
    "origin": ["${cors_origin}"],
    "method": ["GET", "HEAD", "OPTIONS"],
    "responseHeader": ["Content-Type", "Cache-Control", "Content-Encoding", "ETag"],
    "maxAgeSeconds": 3600
  }
]
EOF
)
    echo "$cors_config" | gsutil cors set /dev/stdin "gs://${bucket_name}"

    # Set lifecycle rule (delete old versions)
    local lifecycle_config=$(cat <<EOF
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {
        "numNewerVersions": 3,
        "isLive": false
      }
    }
  ]
}
EOF
)
    echo "$lifecycle_config" | gsutil lifecycle set /dev/stdin "gs://${bucket_name}"

    # Grant public read access
    gcloud storage buckets add-iam-policy-binding "gs://${bucket_name}" \
        --member="allUsers" \
        --role="roles/storage.objectViewer"

    # Add labels
    gcloud storage buckets update "gs://${bucket_name}" \
        --update-labels="environment=${env},managed_by=script,project=nopo"

    log_substep "Bucket created: gs://${bucket_name}"
}

# Create backend bucket for load balancer
create_backend_bucket() {
    local env="$1"
    local bucket_name="nopo-${env}-static"
    local backend_name="nopo-${env}-static-backend"
    local enable_cdn="$2"

    log_substep "Creating backend bucket: ${backend_name}"

    if gcloud compute backend-buckets describe "$backend_name" --project="$PROJECT_ID" &>/dev/null; then
        log_substep "Backend bucket already exists: ${backend_name}"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry "Create backend bucket ${backend_name}"
        if [[ "$enable_cdn" == "true" ]]; then
            log_dry "Enable CDN with cache policy"
        fi
        return 0
    fi

    if [[ "$enable_cdn" == "true" ]]; then
        gcloud compute backend-buckets create "${backend_name}" \
            --project="${PROJECT_ID}" \
            --gcs-bucket-name="${bucket_name}" \
            --description="Backend bucket for static assets" \
            --enable-cdn \
            --cache-mode=CACHE_ALL_STATIC \
            --default-ttl=3600 \
            --max-ttl=86400 \
            --client-ttl=3600 \
            --negative-caching \
            --serve-while-stale=86400
    else
        gcloud compute backend-buckets create "${backend_name}" \
            --project="${PROJECT_ID}" \
            --gcs-bucket-name="${bucket_name}" \
            --description="Backend bucket for static assets"
    fi

    log_substep "Backend bucket created: ${backend_name}"
}

# Setup environment
setup_environment() {
    local env="$1"
    local enable_cdn="false"

    # Enable CDN only for prod
    if [[ "$env" == "prod" && "$ENABLE_CDN" == "true" ]]; then
        enable_cdn="true"
    fi

    log_step "Setting up ${env} environment"

    create_artifact_registry "$env"
    create_storage_bucket "$env"
    create_backend_bucket "$env" "$enable_cdn"
}

# Print summary
print_summary() {
    local envs=("$@")

    echo ""
    echo -e "${BOLD}==================================================${NC}"
    echo -e "${BOLD}        APP INFRASTRUCTURE SETUP COMPLETE${NC}"
    echo -e "${BOLD}==================================================${NC}"
    echo ""

    for env in "${envs[@]}"; do
        local repo_name="nopo-${env}-repo"
        echo -e "${CYAN}${env} environment:${NC}"
        echo "  Artifact Registry: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${repo_name}"
        echo "  Storage bucket:    gs://nopo-${env}-static"
        echo "  Backend bucket:    nopo-${env}-static-backend"
        echo "  CORS origin:       https://${env}.${DOMAIN}"
        echo ""
    done

    echo -e "${CYAN}Push Docker images with:${NC}"
    echo "  docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo-<env>-repo/<image>:<tag>"
    echo ""
    echo -e "${CYAN}Upload static assets with:${NC}"
    echo "  gcloud storage cp -r ./build/* gs://nopo-<env>-static/<service>/"
    echo ""
}

# Main function
main() {
    parse_args "$@"
    validate_params
    check_prerequisites

    echo ""
    echo -e "${BOLD}App Infrastructure Setup${NC}"
    echo ""
    echo "Project:     $PROJECT_ID"
    echo "Region:      $REGION"
    echo "Domain:      $DOMAIN"
    echo "Environment: ${ENVIRONMENT:-stage and prod}"
    echo "CDN:         $ENABLE_CDN (prod only)"
    echo "Dry run:     $DRY_RUN"
    echo ""

    local envs=()

    if [[ -z "$ENVIRONMENT" ]]; then
        envs=("stage" "prod")
    else
        envs=("$ENVIRONMENT")
    fi

    for env in "${envs[@]}"; do
        setup_environment "$env"
    done

    if [[ "$DRY_RUN" != "true" ]]; then
        print_summary "${envs[@]}"
    fi
}

# Run main
main "$@"
