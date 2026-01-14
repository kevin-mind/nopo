#!/usr/bin/env bash
# Check for unresolved review comments on a PR
# Required env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER, PR_NUMBER
set -euo pipefail

repo_name="${GITHUB_REPOSITORY#*/}"

# Get all review threads and check for unresolved ones
unresolved=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
          }
        }
      }
    }
  }
' -f owner="$GITHUB_REPOSITORY_OWNER" -f repo="$repo_name" -F pr="$PR_NUMBER")

# Count unresolved threads (excluding outdated ones)
unresolved_count=$(echo "$unresolved" | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .isOutdated == false)] | length')

echo "Unresolved comment threads: $unresolved_count"

if [[ "$unresolved_count" -gt 0 ]]; then
  echo "has_unresolved=true" >> "$GITHUB_OUTPUT"
  echo "unresolved_count=$unresolved_count" >> "$GITHUB_OUTPUT"
else
  echo "has_unresolved=false" >> "$GITHUB_OUTPUT"
fi
