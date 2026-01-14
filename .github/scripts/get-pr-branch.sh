#!/usr/bin/env bash
# Get PR branch for comment response
# Inputs: IS_PR (true/false), PR_NUMBER
# Outputs: branch, is_pr
set -euo pipefail

if [[ "$IS_PR" == "true" ]]; then
  pr_branch=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json headRefName --jq '.headRefName')
  echo "branch=$pr_branch" >> $GITHUB_OUTPUT
  echo "is_pr=true" >> $GITHUB_OUTPUT
  echo "Detected PR comment on branch: $pr_branch"
else
  echo "branch=main" >> $GITHUB_OUTPUT
  echo "is_pr=false" >> $GITHUB_OUTPUT
  echo "Detected issue comment, using main branch"
fi
