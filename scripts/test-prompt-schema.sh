#!/bin/bash
# Test script for validating prompt schemas with Claude CLI
# Usage: ./scripts/test-prompt-schema.sh [prompt-name]
# If no argument, tests all prompts with outputs.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPTS_DIR="$REPO_ROOT/.github/prompts"
FIXTURES_DIR="$PROMPTS_DIR/fixtures"

test_prompt() {
    local name=$1
    local prompt_dir="$PROMPTS_DIR/$name"
    local prompt_file="$prompt_dir/prompt.txt"
    local schema_file="$prompt_dir/outputs.json"
    local fixture_file="$FIXTURES_DIR/$name.json"

    echo "=== Testing: $name ==="

    if [[ ! -f "$fixture_file" ]]; then
        echo "Error: Fixture not found: $fixture_file"
        return 1
    fi

    # Build prompt from template + fixture
    local prompt=$(cat "$prompt_file")
    while IFS='=' read -r key value; do
        value="${value%\"}"
        value="${value#\"}"
        prompt="${prompt//\{\{$key\}\}/$value}"
    done < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' "$fixture_file")

    # Run Claude with schema
    local schema=$(jq -c . "$schema_file")
    local output_file="/tmp/test-$name.json"

    echo "$prompt" | npx @anthropic-ai/claude-code --print \
        --dangerously-skip-permissions \
        --output-format json \
        --json-schema "$schema" \
        --max-turns 5 \
        - > "$output_file" 2>&1

    # Check structured_output exists
    if jq -e '.structured_output' "$output_file" > /dev/null 2>&1; then
        echo "PASSED: $name"
        return 0
    else
        echo "FAILED: $name - no structured_output"
        cat "$output_file"
        return 1
    fi
}

# If argument provided, test that prompt
if [[ -n "$1" ]]; then
    test_prompt "$1"
    exit $?
fi

# Otherwise test all prompts with outputs.json
failed=0
for schema in "$PROMPTS_DIR"/*/outputs.json; do
    if [[ -f "$schema" ]]; then
        name=$(basename "$(dirname "$schema")")
        if ! test_prompt "$name"; then
            failed=1
        fi
    fi
done

exit $failed
