#!/usr/bin/env bash
#
# Test structured output locally
#
# Usage:
#   ./test-structured-output.sh                    # Use sample issue
#   ./test-structured-output.sh 1234               # Fetch real issue #1234
#   ./test-structured-output.sh --dry-run          # Show prompt without running
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Prompt and schema paths
PROMPT_FILE="$REPO_ROOT/.github/prompts/triage/prompt.txt"
SCHEMA_FILE="$REPO_ROOT/.github/prompts/triage/outputs.json"

# Default sample issue for testing
SAMPLE_ISSUE_NUMBER="9999"
SAMPLE_ISSUE_TITLE="[TEST] Add structured output support"
SAMPLE_ISSUE_BODY="## Description

Add support for structured outputs in the Claude state machine.

## Details

- Need to pass --json-schema to Claude CLI
- Parse the structured output and apply labels/fields

## Questions

- What's the best way to handle complex JSON schemas?"

SAMPLE_AGENT_NOTES="No previous agent notes found."

# Parse arguments
DRY_RUN=false
ISSUE_NUMBER=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--dry-run] [issue_number]"
      echo ""
      echo "Options:"
      echo "  --dry-run     Show the prompt without running Claude"
      echo "  issue_number  Fetch a real issue from GitHub (requires gh CLI)"
      exit 0
      ;;
    *)
      ISSUE_NUMBER="$1"
      shift
      ;;
  esac
done

# Fetch real issue if number provided
if [[ -n "$ISSUE_NUMBER" ]]; then
  echo "Fetching issue #$ISSUE_NUMBER..."
  ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" --json number,title,body)
  SAMPLE_ISSUE_NUMBER=$(echo "$ISSUE_JSON" | jq -r '.number')
  SAMPLE_ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
  SAMPLE_ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '.body')
fi

# Read prompt template
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: Prompt file not found: $PROMPT_FILE"
  exit 1
fi

PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")

# Substitute variables
PROMPT="${PROMPT_TEMPLATE}"
PROMPT="${PROMPT//\{\{ISSUE_NUMBER\}\}/$SAMPLE_ISSUE_NUMBER}"
PROMPT="${PROMPT//\{\{ISSUE_TITLE\}\}/$SAMPLE_ISSUE_TITLE}"
PROMPT="${PROMPT//\{\{ISSUE_BODY\}\}/$SAMPLE_ISSUE_BODY}"
PROMPT="${PROMPT//\{\{AGENT_NOTES\}\}/$SAMPLE_AGENT_NOTES}"

# Read schema
if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "Error: Schema file not found: $SCHEMA_FILE"
  exit 1
fi

SCHEMA=$(cat "$SCHEMA_FILE" | jq -c .)

echo "=== Test Structured Output ==="
echo ""
echo "Issue: #$SAMPLE_ISSUE_NUMBER - $SAMPLE_ISSUE_TITLE"
echo "Schema: $SCHEMA_FILE"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "=== PROMPT ==="
  echo "$PROMPT"
  echo ""
  echo "=== SCHEMA (compact) ==="
  echo "$SCHEMA"
  echo ""
  echo "=== Command (not executed) ==="
  echo "claude --json-schema '\$SCHEMA' --print -p '\$PROMPT'"
  exit 0
fi

# Create temp file for prompt (to handle multi-line properly)
PROMPT_TMP=$(mktemp)
echo "$PROMPT" > "$PROMPT_TMP"

echo "Running Claude with --json-schema..."
echo ""

# Run claude with structured output
# Using --print, --output-format json, and --strict to get only JSON output
set +e
OUTPUT=$(claude --json-schema "$SCHEMA" --output-format json --strict --print -p "$(cat "$PROMPT_TMP")" 2>&1)
EXIT_CODE=$?
set -e

rm -f "$PROMPT_TMP"

echo "=== RAW OUTPUT ==="
echo "$OUTPUT" | head -20
echo ""
echo "Exit code: $EXIT_CODE"

# Extract structured_output from the JSON response
if echo "$OUTPUT" | jq -e '.structured_output' >/dev/null 2>&1; then
  echo ""
  echo "=== STRUCTURED OUTPUT ==="
  echo "$OUTPUT" | jq '.structured_output'
elif echo "$OUTPUT" | jq . >/dev/null 2>&1; then
  echo ""
  echo "=== FULL JSON RESPONSE ==="
  echo "$OUTPUT" | jq .
else
  echo ""
  echo "=== NOT JSON ==="
  echo "$OUTPUT"
fi
