#!/usr/bin/env bash
# Check if issue has the triaged label before allowing implementation
# Inputs: ISSUE_NUMBER
set -euo pipefail

has_triaged=$(gh issue view "$ISSUE_NUMBER" --json labels --jq '.labels[].name' | grep -c "^triaged$" || true)

if [[ "$has_triaged" -eq 0 ]]; then
  gh issue comment "$ISSUE_NUMBER" --body "⚠️ Cannot start implementation - issue is missing the \`triaged\` label.

Please wait for triage to complete or manually add the \`triaged\` label, then re-assign nopo-bot."
  gh issue edit "$ISSUE_NUMBER" --remove-assignee "nopo-bot"
  echo "::error::Issue #$ISSUE_NUMBER is missing 'triaged' label"
  exit 1
fi
