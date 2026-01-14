#!/usr/bin/env bash
# Check how many comments Claude has made on a PR to prevent infinite loops
# Required env: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER
# Optional env: MAX_COMMENTS (default: 20)
set -euo pipefail

MAX_COMMENTS="${MAX_COMMENTS:-20}"

# Count comments from claude[bot] on this PR
review_comments=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/comments" --jq '[.[] | select(.user.login == "claude[bot]")] | length')
issue_comments=$(gh api "/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --jq '[.[] | select(.user.login == "claude[bot]")] | length')
reviews=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/reviews" --jq '[.[] | select(.user.login == "claude[bot]")] | length')

total=$((review_comments + issue_comments + reviews))
echo "Claude has made $total comments/reviews on PR #$PR_NUMBER"

if [[ "$total" -gt "$MAX_COMMENTS" ]]; then
  echo "::error::Claude has made over $MAX_COMMENTS comments on this PR. Stopping to prevent infinite loop."
  exit 1
fi
