#!/usr/bin/env bash
# Add a bot status comment and output the comment ID
# Inputs: ISSUE_NUMBER (or PR_NUMBER), MESSAGE, RUN_URL
# Outputs: comment_id
set -euo pipefail

# Use ISSUE_NUMBER or PR_NUMBER
NUMBER="${ISSUE_NUMBER:-${PR_NUMBER:-}}"
if [[ -z "$NUMBER" ]]; then
  echo "ERROR: Either ISSUE_NUMBER or PR_NUMBER must be set"
  exit 1
fi

comment_url=$(gh issue comment "$NUMBER" --body "$MESSAGE

[View job]($RUN_URL)" 2>&1) || { echo "Failed to post comment: $comment_url"; exit 1; }

# Extract comment ID from the URL (format: https://github.com/owner/repo/issues/N#issuecomment-ID)
comment_id=$(echo "$comment_url" | grep -oP 'issuecomment-\K\d+' || true)
echo "comment_id=$comment_id" >> $GITHUB_OUTPUT

if [[ -z "$comment_id" ]]; then
  echo "ERROR: Comment ID was not extracted. Full gh output:"
  echo "$comment_url"
  exit 1
fi
