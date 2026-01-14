#!/usr/bin/env bash
# Check if PR is authored by Claude
# Inputs: PR_NUMBER
# Outputs: is_claude_pr (true/false)
set -euo pipefail

# Only respond on Claude-authored PRs
author=$(gh pr view "$PR_NUMBER" --json author --jq '.author.login')
if [[ "$author" == "app/claude" || "$author" == "github-actions[bot]" ]]; then
  echo "is_claude_pr=true" >> $GITHUB_OUTPUT
else
  echo "is_claude_pr=false" >> $GITHUB_OUTPUT
  echo "Skipping - not a Claude-authored PR"
fi
