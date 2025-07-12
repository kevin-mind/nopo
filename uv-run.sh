#!/bin/bash

# UV Runner Script - Ensures .venv is properly set up and manages UV commands
# This script works both on the host and in containers

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
VENV_DIR="$PROJECT_ROOT/.venv"
PYTHON_VERSION_FILE="$PROJECT_ROOT/.python-version"
CURRENT_DIR="$(pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[UV-RUN]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[UV-RUN]${NC} $1" >&2
}

error() {
    echo -e "${RED}[UV-RUN]${NC} $1" >&2
}

# Check if UV is available
check_uv() {
    if ! command -v uv &> /dev/null; then
        # Try to source UV from common locations
        for uv_path in "$HOME/.local/bin/env" "$HOME/.cargo/bin/uv" "/usr/local/bin/uv"; do
            if [ -f "$uv_path" ]; then
                if [[ "$uv_path" == *"/env" ]]; then
                    source "$uv_path" 2>/dev/null || true
                else
                    export PATH="$(dirname "$uv_path"):$PATH"
                fi
                break
            fi
        done
        
        if ! command -v uv &> /dev/null; then
            error "UV not found. Please install UV first:"
            error "  curl -LsSf https://astral.sh/uv/install.sh | sh"
            exit 1
        fi
    fi
}

# Check if venv needs repair/creation
needs_repair() {
    if [ ! -d "$VENV_DIR" ]; then
        return 0  # true - needs repair
    fi
    
    if [ ! -f "$VENV_DIR/pyvenv.cfg" ]; then
        return 0  # true - needs repair
    fi
    
    # Check if Python version matches
    if [ -f "$PYTHON_VERSION_FILE" ]; then
        local expected_version
        expected_version=$(cat "$PYTHON_VERSION_FILE" | tr -d '[:space:]')
        
        if [ -f "$VENV_DIR/pyvenv.cfg" ]; then
            local current_version
            current_version=$(grep "version" "$VENV_DIR/pyvenv.cfg" | head -1 | cut -d'=' -f2 | tr -d '[:space:]')
            
            if [[ "$current_version" != "$expected_version"* ]]; then
                return 0  # true - needs repair
            fi
        fi
    fi
    
    return 1  # false - no repair needed
}

# Repair/create the virtual environment
repair_venv() {
    log "Repairing virtual environment at $VENV_DIR"
    
    # Change to project root for UV operations
    cd "$PROJECT_ROOT"
    
    # Remove existing venv if it's corrupted
    if [ -d "$VENV_DIR" ] && [ ! -f "$VENV_DIR/pyvenv.cfg" ]; then
        warn "Removing corrupted virtual environment"
        rm -rf "$VENV_DIR"
    fi
    
    # Sync the environment
    log "Syncing virtual environment..."
    uv sync --frozen || {
        error "Failed to sync virtual environment"
        exit 1
    }
    
    log "Virtual environment ready"
}

# Main execution
main() {
    check_uv
    
    # Always check if repair is needed (but do it from project root)
    if needs_repair; then
        repair_venv
    fi
    
    # If no arguments provided, just ensure venv is ready
    if [ $# -eq 0 ]; then
        log "Virtual environment is ready at $VENV_DIR"
        log "Use 'uv run' to execute commands in the virtual environment"
        exit 0
    fi
    
    # Execute the UV command from the current directory
    # but ensure UV uses the project root's configuration
    log "Executing: uv $*"
    export UV_PROJECT_ENVIRONMENT="$VENV_DIR"
    exec uv "$@"
}

# Run main function
main "$@"