#!/usr/bin/env bash
# Convert PR from draft to ready and request nopo-bot as reviewer
# Required env: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER
set -euo pipefail

# Convert from draft to ready for review
gh pr ready "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" || true
echo "Marked PR #$PR_NUMBER as ready for review"

# Add the review-ready label
gh pr edit "$PR_NUMBER" --add-label "review-ready" || true
echo "Added review-ready label to PR #$PR_NUMBER"

# Request nopo-bot as reviewer to trigger the review workflow
gh pr edit "$PR_NUMBER" --add-reviewer "nopo-bot" --repo "$GITHUB_REPOSITORY"
echo "Requested nopo-bot as reviewer for PR #$PR_NUMBER"
