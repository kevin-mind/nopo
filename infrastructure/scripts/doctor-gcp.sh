#!/usr/bin/env bash
#
# doctor-gcp.sh - GCP Infrastructure Health Check Script
#
# This script inspects your GCP project and checks the health of all
# infrastructure components, identifying issues and suggesting fixes.
#
# Usage:
#   ./doctor-gcp.sh [options]
#
# Options:
#   -p, --project PROJECT_ID   GCP Project ID (or set GCP_PROJECT_ID env var)
#   -e, --environment ENV      Environment: stage or prod (default: stage)
#   -v, --verbose              Show detailed output
#   -h, --help                 Show this help message
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Symbols
CHECK="✓"
CROSS="✗"
WARN="⚠"
INFO="ℹ"
ARROW="→"

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-}"
ENVIRONMENT="stage"
VERBOSE=false
REGION="${GCP_REGION:-us-central1}"
NAME_PREFIX=""
DOMAIN="${DOMAIN:-}"

# Usage
usage() {
    cat << EOF
Usage: $(basename "$0") [options]

GCP Infrastructure Health Check Script

Options:
    -p, --project PROJECT_ID   GCP Project ID (or set GCP_PROJECT_ID env var)
    -e, --environment ENV      Environment: stage or prod (default: stage)
    -r, --region REGION        GCP Region (default: us-central1)
    -d, --domain DOMAIN        Domain name for DNS checks
    -v, --verbose              Show detailed output
    -h, --help                 Show this help message

Examples:
    $(basename "$0") -p my-project-id -e stage
    $(basename "$0") --project my-project-id --environment prod --verbose
    GCP_PROJECT_ID=my-project $(basename "$0")

EOF
    exit 0
}

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--project)
                PROJECT_ID="$2"
                shift 2
                ;;
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -r|--region)
                REGION="$2"
                shift 2
                ;;
            -d|--domain)
                DOMAIN="$2"
                shift 2
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                echo "Unknown option: $1"
                usage
                ;;
        esac
    done
    
    NAME_PREFIX="nopo-${ENVIRONMENT}"
}

# Logging functions
log_check() { echo -e "${BLUE}${BOLD}[CHECK]${NC} $1"; }
log_pass() { echo -e "  ${GREEN}${CHECK}${NC} $1"; ((PASSED++)); }
log_fail() { echo -e "  ${RED}${CROSS}${NC} $1"; ((FAILED++)); }
log_warn() { echo -e "  ${YELLOW}${WARN}${NC} $1"; ((WARNINGS++)); }
log_info() { echo -e "  ${CYAN}${INFO}${NC} $1"; }
log_detail() { $VERBOSE && echo -e "    ${DIM}$1${NC}" || true; }
log_fix() { echo -e "    ${YELLOW}${ARROW} Fix:${NC} $1"; }
log_section() { echo -e "\n${BOLD}━━━ $1 ━━━${NC}"; }

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Check prerequisites
check_prerequisites() {
    log_section "Prerequisites"
    
    log_check "Checking required tools"
    
    if command_exists gcloud; then
        local version=$(gcloud version 2>/dev/null | head -1 | awk '{print $4}')
        log_pass "gcloud CLI installed (${version})"
    else
        log_fail "gcloud CLI not installed"
        log_fix "Install from https://cloud.google.com/sdk/docs/install"
        return 1
    fi
    
    if command_exists jq; then
        log_pass "jq installed"
    else
        log_fail "jq not installed"
        log_fix "brew install jq (macOS) or apt-get install jq (Linux)"
    fi
    
    if command_exists terraform; then
        local tf_version=$(terraform version -json 2>/dev/null | jq -r '.terraform_version' 2>/dev/null || terraform version | head -1)
        log_pass "Terraform installed (${tf_version})"
    else
        log_warn "Terraform not installed (optional for diagnostics)"
    fi
    
    # Check gcloud authentication
    log_check "Checking gcloud authentication"
    
    local auth_account=$(gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>/dev/null | head -1)
    if [[ -n "$auth_account" ]]; then
        log_pass "Authenticated as: ${auth_account}"
    else
        log_fail "Not authenticated with gcloud"
        log_fix "Run: gcloud auth login"
        return 1
    fi
    
    # Check application default credentials
    if [[ -f "$HOME/.config/gcloud/application_default_credentials.json" ]]; then
        log_pass "Application default credentials exist"
    else
        log_warn "Application default credentials not set (needed for Terraform)"
        log_fix "Run: gcloud auth application-default login"
    fi
}

# Check project configuration
check_project() {
    log_section "Project Configuration"
    
    if [[ -z "$PROJECT_ID" ]]; then
        log_fail "Project ID not specified"
        log_fix "Use -p PROJECT_ID or set GCP_PROJECT_ID environment variable"
        return 1
    fi
    
    log_check "Checking project: ${PROJECT_ID}"
    
    if gcloud projects describe "$PROJECT_ID" &>/dev/null; then
        log_pass "Project exists"
        
        # Check project state
        local state=$(gcloud projects describe "$PROJECT_ID" --format="value(lifecycleState)" 2>/dev/null)
        if [[ "$state" == "ACTIVE" ]]; then
            log_pass "Project is ACTIVE"
        else
            log_fail "Project state: ${state}"
        fi
    else
        log_fail "Project not found or not accessible"
        log_fix "Check project ID or run: gcloud projects create ${PROJECT_ID}"
        return 1
    fi
    
    # Check billing
    log_check "Checking billing"
    
    local billing=$(gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled)" 2>/dev/null || echo "false")
    if [[ "$billing" == "True" ]]; then
        log_pass "Billing is enabled"
    else
        log_fail "Billing is not enabled"
        log_fix "Enable billing at https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
    fi
}

# Check required APIs
check_apis() {
    log_section "Required APIs"
    
    local required_apis=(
        "run.googleapis.com:Cloud Run"
        "sqladmin.googleapis.com:Cloud SQL Admin"
        "compute.googleapis.com:Compute Engine"
        "vpcaccess.googleapis.com:VPC Access"
        "secretmanager.googleapis.com:Secret Manager"
        "artifactregistry.googleapis.com:Artifact Registry"
        "servicenetworking.googleapis.com:Service Networking"
        "iam.googleapis.com:IAM"
        "iamcredentials.googleapis.com:IAM Credentials"
        "storage.googleapis.com:Cloud Storage"
    )
    
    log_check "Checking enabled APIs"
    
    local enabled_apis=$(gcloud services list --enabled --project="$PROJECT_ID" --format="value(config.name)" 2>/dev/null)
    
    for api_info in "${required_apis[@]}"; do
        local api="${api_info%%:*}"
        local name="${api_info##*:}"
        
        if echo "$enabled_apis" | grep -q "^${api}$"; then
            log_pass "${name} (${api})"
        else
            log_fail "${name} (${api}) - not enabled"
            log_fix "gcloud services enable ${api} --project=${PROJECT_ID}"
        fi
    done
}

# Check IAM and service accounts
check_iam() {
    log_section "IAM & Service Accounts"
    
    local sa_email="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"
    
    log_check "Checking GitHub Actions service account"
    
    if gcloud iam service-accounts describe "$sa_email" --project="$PROJECT_ID" &>/dev/null; then
        log_pass "Service account exists: ${sa_email}"
        
        # Check roles
        log_check "Checking IAM roles"
        
        local required_roles=(
            "roles/run.admin"
            "roles/iam.serviceAccountUser"
            "roles/artifactregistry.writer"
            "roles/cloudsql.admin"
            "roles/secretmanager.admin"
            "roles/storage.admin"
            "roles/compute.admin"
            "roles/vpcaccess.admin"
        )
        
        local policy=$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json 2>/dev/null)
        
        for role in "${required_roles[@]}"; do
            if echo "$policy" | jq -e ".bindings[] | select(.role == \"${role}\") | .members[] | select(. == \"serviceAccount:${sa_email}\")" &>/dev/null; then
                log_pass "${role}"
            else
                log_fail "${role} - not granted"
                log_fix "gcloud projects add-iam-policy-binding ${PROJECT_ID} --member=serviceAccount:${sa_email} --role=${role}"
            fi
        done
    else
        log_fail "Service account not found"
        log_fix "gcloud iam service-accounts create github-actions --project=${PROJECT_ID}"
    fi
}

# Check Workload Identity Federation
check_workload_identity() {
    log_section "Workload Identity Federation"
    
    log_check "Checking workload identity pool"
    
    if gcloud iam workload-identity-pools describe "github" --location="global" --project="$PROJECT_ID" &>/dev/null; then
        log_pass "Workload identity pool 'github' exists"
        
        # Check provider
        log_check "Checking OIDC provider"
        
        if gcloud iam workload-identity-pools providers describe "github-provider" \
            --location="global" \
            --workload-identity-pool="github" \
            --project="$PROJECT_ID" &>/dev/null; then
            log_pass "OIDC provider 'github-provider' exists"
            
            # Check attribute condition
            local condition=$(gcloud iam workload-identity-pools providers describe "github-provider" \
                --location="global" \
                --workload-identity-pool="github" \
                --project="$PROJECT_ID" \
                --format="value(attributeCondition)" 2>/dev/null)
            
            if [[ -n "$condition" ]]; then
                log_pass "Attribute condition is set"
                log_detail "Condition: ${condition}"
            else
                log_warn "No attribute condition set (security risk)"
                log_fix "Update provider with --attribute-condition"
            fi
        else
            log_fail "OIDC provider not found"
            log_fix "Create with: gcloud iam workload-identity-pools providers create-oidc github-provider ..."
        fi
    else
        log_fail "Workload identity pool not found"
        log_fix "gcloud iam workload-identity-pools create github --location=global --project=${PROJECT_ID}"
    fi
}

# Check Artifact Registry
check_artifact_registry() {
    log_section "Artifact Registry"
    
    log_check "Checking Docker repository"
    
    if gcloud artifacts repositories describe "nopo" --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log_pass "Repository 'nopo' exists in ${REGION}"
        
        # Check for images
        local images=$(gcloud artifacts docker images list "${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo" --format="value(package)" 2>/dev/null | head -5)
        
        if [[ -n "$images" ]]; then
            local count=$(echo "$images" | wc -l)
            log_pass "Found ${count} image(s)"
            log_detail "Images: $(echo $images | tr '\n' ', ')"
        else
            log_warn "No images found in repository"
            log_info "Images will be pushed by CI/CD pipeline"
        fi
    else
        log_fail "Repository 'nopo' not found"
        log_fix "gcloud artifacts repositories create nopo --repository-format=docker --location=${REGION} --project=${PROJECT_ID}"
    fi
}

# Check Terraform state bucket
check_terraform_state() {
    log_section "Terraform State"
    
    local bucket="${PROJECT_ID}-terraform-state"
    
    log_check "Checking state bucket: gs://${bucket}"
    
    if gsutil ls -b "gs://${bucket}" &>/dev/null; then
        log_pass "State bucket exists"
        
        # Check versioning
        local versioning=$(gsutil versioning get "gs://${bucket}" 2>/dev/null)
        if echo "$versioning" | grep -q "Enabled"; then
            log_pass "Versioning is enabled"
        else
            log_warn "Versioning is not enabled"
            log_fix "gsutil versioning set on gs://${bucket}"
        fi
        
        # Check for state files
        local state_files=$(gsutil ls "gs://${bucket}/nopo/${ENVIRONMENT}/**" 2>/dev/null | grep -c "\.tfstate" || echo "0")
        if [[ "$state_files" -gt 0 ]]; then
            log_pass "Found Terraform state files"
        else
            log_warn "No Terraform state files found for ${ENVIRONMENT}"
            log_info "State will be created on first terraform apply"
        fi
    else
        log_fail "State bucket not found"
        log_fix "gcloud storage buckets create gs://${bucket} --location=${REGION} --uniform-bucket-level-access"
    fi
}

# Check Cloud Run services
check_cloud_run() {
    log_section "Cloud Run Services"
    
    log_check "Checking Cloud Run services"
    
    local services=$(gcloud run services list --region="$REGION" --project="$PROJECT_ID" --format="value(metadata.name)" 2>/dev/null | grep "^${NAME_PREFIX}-" || true)
    
    if [[ -z "$services" ]]; then
        log_warn "No Cloud Run services found for ${ENVIRONMENT}"
        log_info "Services will be created by Terraform"
        return
    fi
    
    for service in $services; do
        local service_name="${service#${NAME_PREFIX}-}"
        
        # Get service details
        local status=$(gcloud run services describe "$service" \
            --region="$REGION" \
            --project="$PROJECT_ID" \
            --format="value(status.conditions[0].status)" 2>/dev/null)
        
        local url=$(gcloud run services describe "$service" \
            --region="$REGION" \
            --project="$PROJECT_ID" \
            --format="value(status.url)" 2>/dev/null)
        
        if [[ "$status" == "True" ]]; then
            log_pass "${service_name}: Running"
            log_detail "URL: ${url}"
            
            # Health check
            if [[ -n "$url" ]]; then
                local http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}" 2>/dev/null || echo "000")
                if [[ "$http_code" =~ ^[23] ]]; then
                    log_pass "${service_name}: HTTP ${http_code} - Responding"
                elif [[ "$http_code" == "403" ]]; then
                    log_warn "${service_name}: HTTP 403 - Auth required (expected for private services)"
                else
                    log_warn "${service_name}: HTTP ${http_code} - May have issues"
                fi
            fi
        else
            log_fail "${service_name}: Not ready (status: ${status})"
            log_fix "Check logs: gcloud run services logs read ${service} --region=${REGION} --project=${PROJECT_ID}"
        fi
    done
    
    # Check for migration jobs
    log_check "Checking Cloud Run jobs"
    
    local jobs=$(gcloud run jobs list --region="$REGION" --project="$PROJECT_ID" --format="value(metadata.name)" 2>/dev/null | grep "^${NAME_PREFIX}-" || true)
    
    if [[ -n "$jobs" ]]; then
        for job in $jobs; do
            local job_name="${job#${NAME_PREFIX}-}"
            log_pass "Job: ${job_name}"
        done
    else
        log_info "No Cloud Run jobs found"
    fi
}

# Check Cloud SQL
check_cloud_sql() {
    log_section "Cloud SQL"
    
    local instance_name="${NAME_PREFIX}-db"
    
    log_check "Checking Cloud SQL instance: ${instance_name}"
    
    local instance_info=$(gcloud sql instances describe "$instance_name" --project="$PROJECT_ID" --format=json 2>/dev/null || echo "")
    
    if [[ -n "$instance_info" ]]; then
        local state=$(echo "$instance_info" | jq -r '.state')
        local version=$(echo "$instance_info" | jq -r '.databaseVersion')
        local tier=$(echo "$instance_info" | jq -r '.settings.tier')
        local ip_type=$(echo "$instance_info" | jq -r '.ipAddresses[0].type')
        local ip_addr=$(echo "$instance_info" | jq -r '.ipAddresses[0].ipAddress')
        
        if [[ "$state" == "RUNNABLE" ]]; then
            log_pass "Instance is RUNNABLE"
        else
            log_fail "Instance state: ${state}"
        fi
        
        log_pass "Version: ${version}"
        log_pass "Tier: ${tier}"
        
        if [[ "$ip_type" == "PRIVATE" ]]; then
            log_pass "Using private IP: ${ip_addr}"
        else
            log_warn "Using ${ip_type} IP - consider switching to private"
        fi
        
        # Check database
        log_check "Checking database"
        
        local databases=$(gcloud sql databases list --instance="$instance_name" --project="$PROJECT_ID" --format="value(name)" 2>/dev/null)
        if echo "$databases" | grep -q "${NAME_PREFIX}"; then
            log_pass "Database '${NAME_PREFIX}' exists"
        else
            log_warn "Database '${NAME_PREFIX}' not found"
            log_detail "Available databases: ${databases}"
        fi
        
        # Check user
        local users=$(gcloud sql users list --instance="$instance_name" --project="$PROJECT_ID" --format="value(name)" 2>/dev/null)
        if echo "$users" | grep -q "${NAME_PREFIX}"; then
            log_pass "User '${NAME_PREFIX}' exists"
        else
            log_warn "User '${NAME_PREFIX}' not found"
        fi
    else
        log_warn "Cloud SQL instance not found"
        log_info "Instance will be created by Terraform (takes ~10-15 minutes)"
    fi
}

# Check networking
check_networking() {
    log_section "Networking"
    
    local vpc_name="${NAME_PREFIX}-vpc"
    
    log_check "Checking VPC: ${vpc_name}"
    
    if gcloud compute networks describe "$vpc_name" --project="$PROJECT_ID" &>/dev/null; then
        log_pass "VPC exists"
        
        # Check subnet
        local subnet_name="${NAME_PREFIX}-subnet"
        if gcloud compute networks subnets describe "$subnet_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
            log_pass "Subnet '${subnet_name}' exists"
        else
            log_warn "Subnet not found"
        fi
    else
        log_warn "VPC not found"
        log_info "VPC will be created by Terraform"
    fi
    
    # Check VPC connector
    log_check "Checking VPC connector"
    
    local connector_name="${NAME_PREFIX}-connector"
    local connector_info=$(gcloud compute networks vpc-access connectors describe "$connector_name" \
        --region="$REGION" \
        --project="$PROJECT_ID" \
        --format=json 2>/dev/null || echo "")
    
    if [[ -n "$connector_info" ]]; then
        local connector_state=$(echo "$connector_info" | jq -r '.state')
        if [[ "$connector_state" == "READY" ]]; then
            log_pass "VPC connector is READY"
        else
            log_fail "VPC connector state: ${connector_state}"
        fi
    else
        log_warn "VPC connector not found"
        log_info "Connector will be created by Terraform"
    fi
    
    # Check private service connection
    log_check "Checking private service connection"
    
    local psc=$(gcloud compute addresses list --project="$PROJECT_ID" --filter="name~${NAME_PREFIX}" --format="value(name)" 2>/dev/null | head -1)
    if [[ -n "$psc" ]]; then
        log_pass "Private service connection address exists"
    else
        log_info "Private service connection will be created by Terraform"
    fi
}

# Check secrets
check_secrets() {
    log_section "Secret Manager"
    
    local required_secrets=(
        "${NAME_PREFIX}-db-password:Database password"
        "${NAME_PREFIX}-django-secret:Django secret key"
    )
    
    log_check "Checking secrets"
    
    for secret_info in "${required_secrets[@]}"; do
        local secret_name="${secret_info%%:*}"
        local description="${secret_info##*:}"
        
        if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null; then
            # Check if it has a version
            local versions=$(gcloud secrets versions list "$secret_name" --project="$PROJECT_ID" --format="value(name)" --limit=1 2>/dev/null)
            if [[ -n "$versions" ]]; then
                log_pass "${description} (${secret_name})"
            else
                log_warn "${secret_name} exists but has no versions"
                log_fix "Add a version: echo 'value' | gcloud secrets versions add ${secret_name} --data-file=-"
            fi
        else
            log_warn "${description} (${secret_name}) - not found"
            log_info "Secret will be created by Terraform"
        fi
    done
}

# Check load balancer
check_load_balancer() {
    log_section "Load Balancer"
    
    log_check "Checking global IP address"
    
    local ip_name="${NAME_PREFIX}-lb-ip"
    local ip_addr=$(gcloud compute addresses describe "$ip_name" --global --project="$PROJECT_ID" --format="value(address)" 2>/dev/null || echo "")
    
    if [[ -n "$ip_addr" ]]; then
        log_pass "Static IP: ${ip_addr}"
        LB_IP="$ip_addr"  # Save for later checks
    else
        log_warn "Static IP not found"
        log_info "Load balancer will be created by Terraform"
        return
    fi
    
    # Check URL map
    log_check "Checking URL map"
    
    local url_map="${NAME_PREFIX}-url-map"
    if gcloud compute url-maps describe "$url_map" --project="$PROJECT_ID" &>/dev/null; then
        log_pass "URL map exists"
        
        # Get default service from URL map
        local default_svc=$(gcloud compute url-maps describe "$url_map" --project="$PROJECT_ID" --format="value(defaultService)" 2>/dev/null | awk -F'/' '{print $NF}')
        log_detail "Default service: ${default_svc}"
    else
        log_warn "URL map not found"
    fi
    
    # Check backend services and their health
    log_check "Checking backend services health"
    
    local backend_services=$(gcloud compute backend-services list --project="$PROJECT_ID" --global --format="value(name)" 2>/dev/null | grep "^${NAME_PREFIX}-" || true)
    
    if [[ -n "$backend_services" ]]; then
        for backend in $backend_services; do
            local backend_name="${backend#${NAME_PREFIX}-}"
            backend_name="${backend_name%-backend}"
            
            # Get health status
            local health_output=$(gcloud compute backend-services get-health "$backend" --project="$PROJECT_ID" --global --format=json 2>/dev/null || echo "[]")
            local health_status=$(echo "$health_output" | jq -r '.[0].status.healthStatus[0].healthState // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
            
            case "$health_status" in
                HEALTHY)
                    log_pass "Backend '${backend_name}': HEALTHY"
                    ;;
                UNHEALTHY)
                    log_fail "Backend '${backend_name}': UNHEALTHY"
                    log_fix "Check Cloud Run service logs and ensure it's responding"
                    ;;
                UNKNOWN|"")
                    # For serverless NEGs, health might show differently
                    local neg_count=$(echo "$health_output" | jq -r 'length' 2>/dev/null || echo "0")
                    if [[ "$neg_count" == "0" ]]; then
                        log_warn "Backend '${backend_name}': No health data (serverless NEG)"
                        log_detail "Serverless NEGs don't have traditional health checks"
                    else
                        log_warn "Backend '${backend_name}': ${health_status}"
                    fi
                    ;;
                *)
                    log_warn "Backend '${backend_name}': ${health_status}"
                    ;;
            esac
        done
    else
        log_warn "No backend services found"
    fi
    
    # Check target HTTPS proxy
    log_check "Checking target HTTPS proxy"
    
    local https_proxy="${NAME_PREFIX}-https-proxy"
    local proxy_info=$(gcloud compute target-https-proxies describe "$https_proxy" --project="$PROJECT_ID" --format=json 2>/dev/null || echo "")
    
    if [[ -n "$proxy_info" ]]; then
        log_pass "HTTPS proxy exists"
        local proxy_cert=$(echo "$proxy_info" | jq -r '.sslCertificates[0] // "none"' | awk -F'/' '{print $NF}')
        log_detail "SSL certificate: ${proxy_cert}"
        local proxy_url_map=$(echo "$proxy_info" | jq -r '.urlMap // "none"' | awk -F'/' '{print $NF}')
        log_detail "URL map: ${proxy_url_map}"
    else
        log_warn "HTTPS proxy not found"
    fi
    
    # Check SSL certificate
    log_check "Checking SSL certificate"
    
    local cert_name="${NAME_PREFIX}-ssl-cert"
    local cert_info=$(gcloud compute ssl-certificates describe "$cert_name" --project="$PROJECT_ID" --format=json 2>/dev/null || echo "")
    
    if [[ -n "$cert_info" ]]; then
        local cert_status=$(echo "$cert_info" | jq -r '.managed.status // "UNKNOWN"')
        local domain_status=$(echo "$cert_info" | jq -r '.managed.domainStatus | to_entries[0] | "\(.key): \(.value)"' 2>/dev/null || echo "unknown")
        local cert_created=$(echo "$cert_info" | jq -r '.creationTimestamp // "unknown"')
        
        case "$cert_status" in
            ACTIVE)
                log_pass "SSL certificate is ACTIVE"
                log_detail "Domain status: ${domain_status}"
                ;;
            PROVISIONING)
                log_warn "SSL certificate is PROVISIONING"
                log_detail "Created: ${cert_created}"
                log_detail "Domain status: ${domain_status}"
                
                # Check how long it's been provisioning
                if [[ "$cert_created" != "unknown" ]]; then
                    local created_epoch=$(date -d "${cert_created}" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%S" "${cert_created%%.*}" +%s 2>/dev/null || echo "0")
                    local now_epoch=$(date +%s)
                    local age_minutes=$(( (now_epoch - created_epoch) / 60 ))
                    
                    if [[ $age_minutes -gt 60 ]]; then
                        log_fail "Certificate has been provisioning for ${age_minutes} minutes (>60 min is unusual)"
                        log_info "Possible issues:"
                        log_info "  1. DNS not pointing to load balancer IP (${ip_addr})"
                        log_info "  2. Cloudflare proxy enabled (should be DNS-only/gray cloud)"
                        log_info "  3. CAA records blocking Google CA"
                        log_fix "Try recreating: terraform taint 'module.infrastructure.module.loadbalancer.google_compute_managed_ssl_certificate.default' && terraform apply"
                    else
                        log_info "Certificate provisioning for ${age_minutes} minutes (can take up to 60 min)"
                    fi
                fi
                ;;
            FAILED_NOT_VISIBLE)
                log_fail "SSL certificate FAILED: Domain not visible"
                log_info "Google cannot reach the domain. Check:"
                log_info "  1. DNS points to ${ip_addr}"
                log_info "  2. No firewall blocking Google's validators"
                log_fix "Verify DNS: dig +short ${domain_status%%:*}"
                ;;
            FAILED_CAA_CHECKING)
                log_fail "SSL certificate FAILED: CAA record issue"
                log_info "CAA records may be blocking Google's CA"
                log_fix "Check CAA records: dig CAA ${DOMAIN:-example.com}"
                ;;
            FAILED_CAA_FORBIDDEN)
                log_fail "SSL certificate FAILED: CAA forbids Google CA"
                log_fix "Add CAA record allowing Google: 0 issue \"pki.goog\""
                ;;
            FAILED_RATE_LIMITED)
                log_fail "SSL certificate FAILED: Rate limited"
                log_info "Too many certificate requests. Wait and try again."
                ;;
            FAILED_*)
                log_fail "SSL certificate FAILED: ${cert_status}"
                log_detail "Domain status: ${domain_status}"
                log_fix "Check DNS configuration and try recreating the certificate"
                ;;
            *)
                log_warn "SSL certificate status: ${cert_status}"
                ;;
        esac
    else
        log_warn "SSL certificate not found"
        log_info "Certificate will be created by Terraform"
    fi
    
    # Check forwarding rules
    log_check "Checking forwarding rules"
    
    local https_rule="${NAME_PREFIX}-https-rule"
    local https_rule_info=$(gcloud compute forwarding-rules describe "$https_rule" --global --project="$PROJECT_ID" --format=json 2>/dev/null || echo "")
    
    if [[ -n "$https_rule_info" ]]; then
        log_pass "HTTPS forwarding rule exists (port 443)"
        local rule_ip=$(echo "$https_rule_info" | jq -r '.IPAddress // "unknown"')
        local rule_target=$(echo "$https_rule_info" | jq -r '.target // "unknown"' | awk -F'/' '{print $NF}')
        log_detail "IP: ${rule_ip}, Target: ${rule_target}"
    else
        log_warn "HTTPS forwarding rule not found"
    fi
    
    local http_rule="${NAME_PREFIX}-http-rule"
    if gcloud compute forwarding-rules describe "$http_rule" --global --project="$PROJECT_ID" &>/dev/null; then
        log_pass "HTTP forwarding rule exists (port 80, for redirect)"
    else
        log_warn "HTTP forwarding rule not found"
    fi
    
    # Test actual connectivity
    log_check "Testing load balancer connectivity"
    
    # Test HTTP (should redirect)
    local http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://${ip_addr}" -H "Host: test.example.com" 2>/dev/null || echo "000")
    if [[ "$http_code" == "301" || "$http_code" == "302" ]]; then
        log_pass "HTTP redirect working (${http_code})"
    elif [[ "$http_code" == "000" ]]; then
        log_fail "HTTP not responding on port 80"
    else
        log_warn "HTTP returned ${http_code} (expected 301/302)"
    fi
    
    # Test HTTPS (may fail if cert not ready)
    local https_code=$(curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://${ip_addr}" -H "Host: test.example.com" 2>/dev/null || echo "000")
    if [[ "$https_code" =~ ^[234] ]]; then
        log_pass "HTTPS responding (${https_code})"
    elif [[ "$https_code" == "000" ]]; then
        log_warn "HTTPS not responding (certificate may still be provisioning)"
    else
        log_warn "HTTPS returned ${https_code}"
    fi
}

# Check DNS
check_dns() {
    log_section "DNS Configuration"
    
    if [[ -z "$DOMAIN" ]]; then
        log_info "Domain not specified, skipping DNS checks"
        log_info "Use -d DOMAIN to check DNS configuration"
        return
    fi
    
    local fqdn
    if [[ "$ENVIRONMENT" == "prod" ]]; then
        fqdn="$DOMAIN"
    else
        fqdn="${ENVIRONMENT}.${DOMAIN}"
    fi
    
    log_check "Checking DNS for: ${fqdn}"
    
    # Get expected IP
    local ip_name="${NAME_PREFIX}-lb-ip"
    local expected_ip=$(gcloud compute addresses describe "$ip_name" --global --project="$PROJECT_ID" --format="value(address)" 2>/dev/null || echo "")
    
    # Resolve DNS
    local resolved_ip=$(dig +short "$fqdn" 2>/dev/null | head -1)
    
    if [[ -n "$resolved_ip" ]]; then
        log_pass "DNS resolves to: ${resolved_ip}"
        
        if [[ "$resolved_ip" == "$expected_ip" ]]; then
            log_pass "DNS points to correct Load Balancer IP"
        elif [[ -n "$expected_ip" ]]; then
            log_fail "DNS does not point to Load Balancer"
            log_info "Expected: ${expected_ip}"
            log_info "Got: ${resolved_ip}"
            log_fix "Update DNS A record for ${fqdn} to ${expected_ip}"
        fi
    else
        log_fail "DNS does not resolve"
        if [[ -n "$expected_ip" ]]; then
            log_fix "Add DNS A record: ${fqdn} → ${expected_ip}"
        fi
    fi
    
    # Check HTTPS connectivity
    log_check "Checking HTTPS connectivity"
    
    local https_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${fqdn}" 2>/dev/null || echo "000")
    
    case "$https_code" in
        200|301|302)
            log_pass "HTTPS is working (HTTP ${https_code})"
            ;;
        000)
            log_fail "HTTPS connection failed"
            log_info "SSL certificate may still be provisioning"
            ;;
        *)
            log_warn "HTTPS returned HTTP ${https_code}"
            ;;
    esac
}

# Check GitHub integration
check_github() {
    log_section "GitHub Integration"
    
    log_info "Manual verification required for GitHub settings"
    
    echo ""
    echo "  Verify these settings in your GitHub repository:"
    echo ""
    echo "  Repository Variables (Settings → Secrets and variables → Actions → Variables):"
    echo "    • GCP_PROJECT_ID = ${PROJECT_ID}"
    echo "    • GCP_ARTIFACT_REGISTRY = ${REGION}-docker.pkg.dev/${PROJECT_ID}/nopo"
    echo "    • TERRAFORM_STATE_BUCKET = ${PROJECT_ID}-terraform-state"
    if [[ -n "$DOMAIN" ]]; then
        echo "    • DOMAIN = ${DOMAIN}"
    fi
    echo ""
    echo "  Repository Secrets (Settings → Secrets and variables → Actions → Secrets):"
    echo "    • GCP_WORKLOAD_IDENTITY_PROVIDER = projects/${PROJECT_ID}/locations/global/workloadIdentityPools/github/providers/github-provider"
    echo "    • GCP_SERVICE_ACCOUNT = github-actions@${PROJECT_ID}.iam.gserviceaccount.com"
    echo ""
}

# Print summary
print_summary() {
    log_section "Summary"
    
    local total=$((PASSED + FAILED + WARNINGS))
    
    echo ""
    echo -e "  ${GREEN}${CHECK} Passed:${NC}   ${PASSED}"
    echo -e "  ${RED}${CROSS} Failed:${NC}   ${FAILED}"
    echo -e "  ${YELLOW}${WARN} Warnings:${NC} ${WARNINGS}"
    echo ""
    
    if [[ $FAILED -eq 0 && $WARNINGS -eq 0 ]]; then
        echo -e "  ${GREEN}${BOLD}All checks passed! Your infrastructure looks healthy.${NC}"
    elif [[ $FAILED -eq 0 ]]; then
        echo -e "  ${YELLOW}${BOLD}Infrastructure is functional but has warnings to address.${NC}"
    else
        echo -e "  ${RED}${BOLD}Infrastructure has issues that need to be fixed.${NC}"
    fi
    echo ""
    
    return $FAILED
}

# Main
main() {
    parse_args "$@"
    
    echo ""
    echo -e "${BOLD}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║          GCP Infrastructure Health Check                  ║${NC}"
    echo -e "${BOLD}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Project:     ${CYAN}${PROJECT_ID:-not set}${NC}"
    echo -e "  Environment: ${CYAN}${ENVIRONMENT}${NC}"
    echo -e "  Region:      ${CYAN}${REGION}${NC}"
    if [[ -n "$DOMAIN" ]]; then
        echo -e "  Domain:      ${CYAN}${DOMAIN}${NC}"
    fi
    
    check_prerequisites || exit 1
    check_project || exit 1
    check_apis
    check_iam
    check_workload_identity
    check_artifact_registry
    check_terraform_state
    check_networking
    check_secrets
    check_cloud_sql
    check_cloud_run
    check_load_balancer
    check_dns
    check_github
    
    print_summary
}

main "$@"
