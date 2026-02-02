#!/bin/bash
# Test SDK spike in Docker container mimicking GitHub Actions environment
#
# Usage:
#   CLAUDE_CODE_OAUTH_TOKEN=... ./docker-test.sh   # Preferred - bills to Max subscription
#   ANTHROPIC_API_KEY=sk-ant-... ./docker-test.sh  # Alternative - bills to API directly
#
# PRODUCTION: Use CLAUDE_CODE_OAUTH_TOKEN
#   - Bills to your Claude Max subscription
#   - Same as GitHub Actions secrets setup
#
# TESTING: Can use ANTHROPIC_API_KEY
#   - Bills directly to Anthropic API
#   - Useful for quick local testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=============================================="
echo "SDK Spike - Docker Test (GitHub Actions env)"
echo "=============================================="
echo ""

# Check for auth
if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "Error: No API key found."
    echo ""
    echo "Claude CLI uses macOS Keychain for auth, which isn't accessible in Docker."
    echo "To test in Docker, set one of:"
    echo ""
    echo "  ANTHROPIC_API_KEY=sk-ant-...  ./docker-test.sh"
    echo "  CLAUDE_CODE_OAUTH_TOKEN=...   ./docker-test.sh"
    echo ""
    echo "Get an API key from: https://console.anthropic.com/"
    exit 1
fi

# Helper to obfuscate tokens for logging
obfuscate() {
    local token="$1"
    local len=${#token}
    if [ $len -le 12 ]; then
        echo "***"
    else
        echo "${token:0:8}...${token: -4}"
    fi
}

# Determine which env var to pass (prefer OAuth token for Max subscription billing)
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    AUTH_ENV="-e CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN"
    echo "Using: CLAUDE_CODE_OAUTH_TOKEN (Max subscription) $(obfuscate "$CLAUDE_CODE_OAUTH_TOKEN")"
elif [ -n "$ANTHROPIC_API_KEY" ]; then
    AUTH_ENV="-e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
    echo "Using: ANTHROPIC_API_KEY (API billing) $(obfuscate "$ANTHROPIC_API_KEY")"
    echo "Note: For production, use CLAUDE_CODE_OAUTH_TOKEN to bill to Max subscription"
fi

# Build the Docker image
echo ""
echo "Building Docker image..."
docker build -t sdk-spike-test . --quiet

# Run tests
echo ""
echo "Running tests in Docker container..."
echo ""

docker run --rm \
    $AUTH_ENV \
    -e CI=true \
    -e FORCE_COLOR=1 \
    sdk-spike-test \
    npx tsx test-gha-env.ts

echo ""
echo "=============================================="
echo "Docker test complete!"
echo "=============================================="
