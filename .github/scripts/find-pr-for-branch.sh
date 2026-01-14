#!/usr/bin/env bash
# Find PR for a branch and output its details
# Required env: GH_TOKEN, GITHUB_REPOSITORY, HEAD_BRANCH
# Optional env: INPUT_PR_NUMBER, INPUT_CONCLUSION (for workflow_dispatch)
set -euo pipefail

# Handle workflow_dispatch - get PR directly by number
if [[ -n "${INPUT_PR_NUMBER:-}" ]]; then
  echo "Manual trigger for PR #$INPUT_PR_NUMBER"
  pr=$(gh pr view "$INPUT_PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json number,author,isDraft,body,headRefName)
  echo "conclusion=$INPUT_CONCLUSION" >> "$GITHUB_OUTPUT"
# Check if this is a merge queue branch (gh-readonly-queue/main/pr-NNN-...)
elif [[ "$HEAD_BRANCH" =~ ^gh-readonly-queue/.*/pr-([0-9]+)- ]]; then
  pr_number="${BASH_REMATCH[1]}"
  echo "Merge queue branch detected, extracting PR #$pr_number"
  pr=$(gh pr view "$pr_number" --repo "$GITHUB_REPOSITORY" --json number,author,isDraft,body,headRefName)
else
  # Find PR for this branch
  pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$HEAD_BRANCH" --json number,author,isDraft,body,headRefName --jq '.[0]')
fi

if [[ -z "$pr" || "$pr" == "null" ]]; then
  echo "No PR found for branch $HEAD_BRANCH"
  echo "has_pr=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

pr_number=$(echo "$pr" | jq -r '.number')
author=$(echo "$pr" | jq -r '.author.login')
is_draft=$(echo "$pr" | jq -r '.isDraft')
pr_body=$(echo "$pr" | jq -r '.body')
pr_head_branch=$(echo "$pr" | jq -r '.headRefName')

echo "PR #$pr_number by $author (draft: $is_draft) on branch $pr_head_branch"
{
  echo "has_pr=true"
  echo "pr_number=$pr_number"
  echo "pr_head_branch=$pr_head_branch"
  echo "is_draft=$is_draft"
} >> "$GITHUB_OUTPUT"

# Store body for later use (heredoc style)
{
  echo "pr_body<<EOF"
  echo "$pr_body"
  echo "EOF"
} >> "$GITHUB_OUTPUT"

# Check if PR was created by Claude automation
if [[ "$author" == "claude[bot]" ]]; then
  echo "is_claude_pr=true" >> "$GITHUB_OUTPUT"
else
  echo "is_claude_pr=false" >> "$GITHUB_OUTPUT"
fi

# Extract linked issue from "Fixes #N" pattern
issue_number=$(echo "$pr_body" | grep -oP 'Fixes #\K\d+' | head -1 || true)

if [[ -z "$issue_number" ]]; then
  echo "No linked issue found in PR body"
  echo "has_issue=false" >> "$GITHUB_OUTPUT"
else
  echo "Found linked issue #$issue_number"
  echo "has_issue=true" >> "$GITHUB_OUTPUT"
  echo "issue_number=$issue_number" >> "$GITHUB_OUTPUT"
fi
