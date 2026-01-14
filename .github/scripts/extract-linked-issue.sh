#!/usr/bin/env bash
# Extract linked issue from PR body (looks for "Fixes #N")
# Inputs: PR_NUMBER
# Outputs: has_issue, number, body
set -euo pipefail

pr_body=$(gh pr view "$PR_NUMBER" --json body --jq '.body')
issue_number=$(echo "$pr_body" | grep -oP 'Fixes #\K\d+' | head -1 || true)

if [[ -n "$issue_number" ]]; then
  echo "has_issue=true" >> $GITHUB_OUTPUT
  echo "number=$issue_number" >> $GITHUB_OUTPUT

  issue_body=$(gh issue view "$issue_number" --json body --jq '.body')
  echo "body<<EOF" >> $GITHUB_OUTPUT
  echo "$issue_body" >> $GITHUB_OUTPUT
  echo "EOF" >> $GITHUB_OUTPUT
else
  echo "has_issue=false" >> $GITHUB_OUTPUT
fi
