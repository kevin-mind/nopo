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

# Resolve apps directory
if [[ ! "${APPS_DIR}" = /* ]]; then
    APPS_DIR="${REPO_ROOT}/${APPS_DIR}"
fi

# Validate apps directory exists
if [[ ! -d "${APPS_DIR}" ]]; then
    log_error "Apps directory not found: ${APPS_DIR}"
    exit 1
fi

log_info "Scanning for services in: ${APPS_DIR}"

# Discover services (directories with Dockerfiles)
SERVICES_JSON="[]"
for dir in "${APPS_DIR}"/*/; do
    if [[ -f "${dir}Dockerfile" ]]; then
        service_name=$(basename "${dir}")
        log_info "  Found service: ${service_name}"
        
        # Default configuration
        cpu="1"
        memory="512Mi"
        port=3000
        min_instances=0
        max_instances=10
        has_database=false
        run_migrations=false
        
        # Check for service-specific config file
        config_file="${dir}infrastructure.json"
        if [[ -f "${config_file}" ]]; then
            log_info "    Loading config from infrastructure.json"
            cpu=$(jq -r '.cpu // "1"' "${config_file}")
            memory=$(jq -r '.memory // "512Mi"' "${config_file}")
            port=$(jq '.port // 3000' "${config_file}")
            min_instances=$(jq '.min_instances // 0' "${config_file}")
            max_instances=$(jq '.max_instances // 10' "${config_file}")
            has_database=$(jq '.has_database // false' "${config_file}")
            run_migrations=$(jq '.run_migrations // false' "${config_file}")
        fi
        
        # Build image URL if registry and version provided
        image=""
        if [[ -n "${REGISTRY}" && -n "${VERSION}" ]]; then
            image="${REGISTRY}/${service_name}:${VERSION}"
        fi
        
        # Build service object and add to array
        service_obj=$(jq -n \
            --arg name "${service_name}" \
            --arg cpu "${cpu}" \
            --arg memory "${memory}" \
            --argjson port "${port}" \
            --argjson min "${min_instances}" \
            --argjson max "${max_instances}" \
            --argjson db "${has_database}" \
            --argjson migrate "${run_migrations}" \
            --arg image "${image}" \
            '{
                name: $name,
                cpu: $cpu,
                memory: $memory,
                port: $port,
                min_instances: $min,
                max_instances: $max,
                has_database: $db,
                run_migrations: $migrate,
                image: $image
            }')
        
        SERVICES_JSON=$(echo "${SERVICES_JSON}" | jq --argjson svc "${service_obj}" '. + [$svc]')
    fi
done

service_count=$(echo "${SERVICES_JSON}" | jq 'length')
log_info "Discovered ${service_count} service(s)"

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
