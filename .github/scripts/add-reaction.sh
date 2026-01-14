#!/usr/bin/env bash
# Add reaction to a comment (rocket for success, confused for failure)
# Inputs: COMMENT_ID, SUCCESS (true/false)
set -euo pipefail

if [[ -z "${COMMENT_ID:-}" ]]; then
  echo "No bot comment ID found, skipping reaction"
  exit 0
fi

if [[ "$SUCCESS" == "true" ]]; then
  reaction="rocket"
else
  reaction="confused"
fi
gh api "/repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID/reactions" \
  -f content="$reaction" || true
