#!/usr/bin/env bash
#
# sync-services.sh - Scan apps directory and generate Terraform service configuration
#
# This script discovers services from the apps/ directory and generates
# a Terraform variables file that defines which services to deploy.
#
# Usage:
#   ./sync-services.sh [options]
#
# Options:
#   --apps-dir DIR       Directory containing service subdirectories (default: apps)
#   --output FILE        Output file for Terraform variables (default: services.auto.tfvars.json)
#   --registry URL       Container registry URL
#   --version TAG        Image version/tag
#   --dry-run            Print output without writing file
#   --help               Show this help message

set -euo pipefail

# Default values
APPS_DIR="apps"
OUTPUT_FILE="services.auto.tfvars.json"
REGISTRY=""
VERSION=""
DRY_RUN=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

show_help() {
    head -20 "$0" | tail -15 | sed 's/^# //'
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --apps-dir) APPS_DIR="$2"; shift 2 ;;
        --output) OUTPUT_FILE="$2"; shift 2 ;;
        --registry) REGISTRY="$2"; shift 2 ;;
        --version) VERSION="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) log_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

# Find repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PATH="${REPO_ROOT}/node_modules/.bin:${PATH}"

# Resolve apps directory
if [[ ! "${APPS_DIR}" = /* ]]; then
    APPS_DIR="${REPO_ROOT}/${APPS_DIR}"
fi

# Validate apps directory exists
if [[ ! -d "${APPS_DIR}" ]]; then
    log_error "Apps directory not found: ${APPS_DIR}"
    exit 1
fi

log_info "Scanning services declared in nopo.yml"

# Discover services declared in nopo.yml
SERVICES_PAYLOAD=$(make -C "${REPO_ROOT}" config validate -- --json --services-only)

if [[ -z "${SERVICES_PAYLOAD}" || "${SERVICES_PAYLOAD}" == "null" ]]; then
    log_error "Unable to load services from nopo.yml"
    exit 1
fi

DIRECTORY_SERVICES=$(echo "${SERVICES_PAYLOAD}" | jq 'with_entries(select(.value.kind == "directory"))')
service_count=$(echo "${DIRECTORY_SERVICES}" | jq 'length')
log_info "Discovered ${service_count} service(s) via nopo.yml"

SERVICES_JSON=$(echo "${DIRECTORY_SERVICES}" | jq --arg registry "${REGISTRY}" --arg version "${VERSION}" '
    to_entries
    | map({
        name: .key,
        cpu: .value.infrastructure.cpu,
        memory: .value.infrastructure.memory,
        port: .value.infrastructure.port,
        min_instances: .value.infrastructure.min_instances,
        max_instances: .value.infrastructure.max_instances,
        has_database: .value.infrastructure.has_database,
        run_migrations: .value.infrastructure.run_migrations,
        static_path: .value.static_path,
        image: (if ($registry != "" and $version != "") then "\($registry)/\(.key):\($version)" else "" end)
    })
')

# Convert to map keyed by service name for Terraform for_each
SERVICES_MAP=$(echo "${SERVICES_JSON}" | jq 'map({(.name): .}) | add // {}')

# Build final output
OUTPUT=$(jq -n \
    --argjson services "${SERVICES_MAP}" \
    --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg apps_dir "${APPS_DIR}" \
    '{
        "_generated": {
            "at": $generated_at,
            "from": $apps_dir,
            "warning": "This file is auto-generated. Do not edit manually."
        },
        "services": $services
    }')

# Output or write file
if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "Dry run - would write to ${OUTPUT_FILE}:"
    echo "${OUTPUT}" | jq .
else
    # Determine output path
    if [[ ! "${OUTPUT_FILE}" = /* ]]; then
        OUTPUT_FILE="${REPO_ROOT}/infrastructure/terraform/${OUTPUT_FILE}"
    fi
    
    echo "${OUTPUT}" | jq . > "${OUTPUT_FILE}"
    log_info "Written to: ${OUTPUT_FILE}"
fi

log_info "Done!"
