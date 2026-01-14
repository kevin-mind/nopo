#!/usr/bin/env bash
# Find and convert a PR to draft if it exists and is not already a draft
# Required env: GH_TOKEN, GITHUB_REPOSITORY, HEAD_BRANCH
set -euo pipefail

# Find PR for this branch
pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$HEAD_BRANCH" --json number,isDraft --jq '.[0]')

if [[ -z "$pr" || "$pr" == "null" ]]; then
  echo "No PR found for branch $HEAD_BRANCH"
  exit 0
fi

pr_number=$(echo "$pr" | jq -r '.number')
is_draft=$(echo "$pr" | jq -r '.isDraft')

if [[ "$is_draft" == "true" ]]; then
  echo "PR #$pr_number is already a draft"
  exit 0
fi

# Convert to draft
gh pr ready "$pr_number" --undo --repo "$GITHUB_REPOSITORY"
echo "Converted PR #$pr_number to draft (push detected, CI will mark ready when green)"
