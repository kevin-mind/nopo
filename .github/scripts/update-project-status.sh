#!/usr/bin/env bash
# Update a GitHub Project item's status field
# Required env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER, ISSUE_NUMBER, TARGET_STATUS
set -euo pipefail

repo_name="${GITHUB_REPOSITORY#*/}"

# Get the issue's project item
issue_data=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        projectItems(first: 10) {
          nodes {
            id
            project { id }
          }
        }
      }
    }
  }
' -f owner="$GITHUB_REPOSITORY_OWNER" -f repo="$repo_name" -F number="$ISSUE_NUMBER")

item_id=$(echo "$issue_data" | jq -r '.data.repository.issue.projectItems.nodes[0].id // empty')
project_id=$(echo "$issue_data" | jq -r '.data.repository.issue.projectItems.nodes[0].project.id // empty')

if [[ -z "$item_id" || "$item_id" == "null" ]]; then
  echo "Issue #$ISSUE_NUMBER not linked to any project"
  exit 0
fi

echo "Found project item: $item_id in project: $project_id"

# Get Status field and target option IDs
fields=$(gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
' -f projectId="$project_id")

field_id=$(echo "$fields" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .id')
option_id=$(echo "$fields" | jq -r --arg status "$TARGET_STATUS" '.data.node.fields.nodes[] | select(.name == "Status") | .options[] | select(.name == $status) | .id')

if [[ -z "$field_id" || -z "$option_id" ]]; then
  echo "Could not find Status field or '$TARGET_STATUS' option"
  exit 0
fi

# Update to target status
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) { projectV2Item { id } }
  }
' -f projectId="$project_id" -f itemId="$item_id" -f fieldId="$field_id" -f optionId="$option_id"

echo "Updated issue #$ISSUE_NUMBER to '$TARGET_STATUS' status"
