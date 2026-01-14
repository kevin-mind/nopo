#!/usr/bin/env bash
# Check if there's already a PR for this issue
# Inputs: ISSUE_NUMBER
# Outputs: should_implement (true/false)
set -euo pipefail

# Check if there's already a PR for this issue
existing_pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --search "Fixes #$ISSUE_NUMBER in:body" --json number --jq '.[0].number' || true)

if [[ -n "$existing_pr" && "$existing_pr" != "null" ]]; then
  echo "PR #$existing_pr already exists for issue #$ISSUE_NUMBER"
  echo "should_implement=false" >> $GITHUB_OUTPUT
else
  echo "No existing PR found - proceeding with implementation"
  echo "should_implement=true" >> $GITHUB_OUTPUT
fi
