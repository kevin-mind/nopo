#!/usr/bin/env bash
# Update project status to "In review" for an issue
# Inputs: ISSUE_NUMBER
set -euo pipefail

result=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 10) {
          nodes {
            id
            project { id }
          }
        }
      }
    }
  }
' -f owner="${GITHUB_REPOSITORY_OWNER}" -f repo="${GITHUB_REPOSITORY#*/}" -F number="$ISSUE_NUMBER")

item_id=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].id // empty')
project_id=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].project.id // empty')

if [[ -z "$item_id" || -z "$project_id" ]]; then
  echo "Issue not linked to a project - skipping status update"
  exit 0
fi

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
option_id=$(echo "$fields" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .options[] | select(.name == "In review") | .id')

if [[ -z "$field_id" || -z "$option_id" ]]; then
  echo "Could not find Status field or In review option"
  exit 0
fi

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

echo "Updated project item to In review status"
