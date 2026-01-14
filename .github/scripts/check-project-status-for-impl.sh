#!/usr/bin/env bash
# Check if project status allows implementation (Ready or In progress)
# Inputs: ISSUE_NUMBER
set -euo pipefail

# Get project item status for this issue
result=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 10) {
          nodes {
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    }
  }
' -f owner="${GITHUB_REPOSITORY_OWNER}" -f repo="${GITHUB_REPOSITORY#*/}" -F number="$ISSUE_NUMBER" 2>/dev/null || echo '{}')

status=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].fieldValueByName.name // empty')

if [[ -z "$status" ]]; then
  echo "Issue not linked to a project - skipping status check"
elif [[ "$status" == "Ready" || "$status" == "In progress" ]]; then
  echo "Issue status '$status' allows implementation - proceeding"
else
  gh issue comment "$ISSUE_NUMBER" --body "⚠️ Cannot start implementation - issue status is **$status**.

Implementation requires status to be **Ready** or **In progress**.
Please move the issue to **Ready** status in the project board, then re-assign nopo-bot."
  gh issue edit "$ISSUE_NUMBER" --remove-assignee "nopo-bot"
  echo "::error::Issue #$ISSUE_NUMBER status is '$status', must be Ready or In progress"
  exit 1
fi
