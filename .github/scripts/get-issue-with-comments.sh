#!/usr/bin/env bash
# Get issue body with recent comments for context
# Inputs: ISSUE_NUMBER
# Outputs: body (multiline)
set -euo pipefail

# Get issue body
gh issue view "$ISSUE_NUMBER" --json body --jq '.body' > /tmp/issue_body.txt

# Get recent comments (last 10) for context on prior attempts
gh issue view "$ISSUE_NUMBER" --json comments \
  --jq '.comments[-10:] | .[] | "---\n**\(.author.login)** (\(.createdAt)):\n\(.body)\n"' \
  > /tmp/issue_comments.txt || true

# Combine body and comments for prompt context
echo "body<<EOF" >> $GITHUB_OUTPUT
cat /tmp/issue_body.txt >> $GITHUB_OUTPUT
if [[ -s /tmp/issue_comments.txt ]]; then
  echo "" >> $GITHUB_OUTPUT
  echo "## Recent Comments" >> $GITHUB_OUTPUT
  cat /tmp/issue_comments.txt >> $GITHUB_OUTPUT
fi
echo "EOF" >> $GITHUB_OUTPUT
