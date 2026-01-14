#!/usr/bin/env bash
# Apply labels and project fields from triage output (triage-output.json)
# Inputs: ISSUE_NUMBER
set -euo pipefail

# Read triage output from Claude
if [[ ! -f triage-output.json ]]; then
  echo "ERROR: triage-output.json not found - Claude may not have created it"
  echo "Applying minimal triaged label only"
  gh issue edit "$ISSUE_NUMBER" --add-label "triaged"
  exit 0
fi

echo "Reading triage output:"
cat triage-output.json

# Parse triage output
TYPE=$(jq -r '.type // empty' triage-output.json)
PRIORITY=$(jq -r '.priority // empty' triage-output.json)
SIZE=$(jq -r '.size // empty' triage-output.json)
ESTIMATE=$(jq -r '.estimate // 5' triage-output.json)
NEEDS_INFO=$(jq -r '.needs_info // false' triage-output.json)

# Build labels list
LABELS="triaged"

# Add type label
if [[ -n "$TYPE" && "$TYPE" != "null" ]]; then
  LABELS="$LABELS,$TYPE"
fi

# Note: priority is NOT added as a label - it's only set in project fields

# Add needs-info label if needed
if [[ "$NEEDS_INFO" == "true" ]]; then
  LABELS="$LABELS,needs-info"
fi

# Add topic labels (create if they don't exist)
TOPICS=$(jq -r '.topics[]? // empty' triage-output.json)
for topic in $TOPICS; do
  topic_label="topic:$topic"
  # Check if label exists, create if not
  if ! gh label list --search "$topic_label" --json name --jq '.[].name' | grep -q "^$topic_label$"; then
    echo "Creating new topic label: $topic_label"
    gh label create "$topic_label" --color "7057ff" --description "Related to $topic" || true
  fi
  LABELS="$LABELS,$topic_label"
done

echo "Applying labels: $LABELS"
gh issue edit "$ISSUE_NUMBER" --add-label "$LABELS"

# =============================================
# Update project fields
# =============================================

# Map priority to project field option IDs
case "$PRIORITY" in
  critical) PRIORITY_OPTION_ID="79628723" ;;  # P0
  high)     PRIORITY_OPTION_ID="0a877460" ;;  # P1
  *)        PRIORITY_OPTION_ID="da944a9c" ;;  # P2 (medium, low, or default)
esac

# Map size to project field option IDs
case "$SIZE" in
  xs) SIZE_OPTION_ID="6c6483d2" ;;
  s)  SIZE_OPTION_ID="f784b110" ;;
  m)  SIZE_OPTION_ID="7515a9f1" ;;
  l)  SIZE_OPTION_ID="817d0097" ;;
  xl) SIZE_OPTION_ID="db339eb2" ;;
  *)  SIZE_OPTION_ID="7515a9f1" ;;  # Default to M
esac

# Get project item ID
result=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 1) {
          nodes { id project { id } }
        }
      }
    }
  }
' -f owner="${GITHUB_REPOSITORY_OWNER}" -f repo="${GITHUB_REPOSITORY#*/}" -F number="$ISSUE_NUMBER" 2>/dev/null || echo '{}')

ITEM_ID=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].id // empty')
PROJECT_ID=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].project.id // empty')

if [[ -z "$ITEM_ID" || "$ITEM_ID" == "null" ]]; then
  echo "Issue not linked to a project - skipping project field updates"
  exit 0
fi

echo "Updating project fields: Priority=$PRIORITY_OPTION_ID, Size=$SIZE_OPTION_ID, Estimate=$ESTIMATE"

# Update Priority field
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }
' -f projectId="$PROJECT_ID" -f itemId="$ITEM_ID" \
  -f fieldId="PVTSSF_lADOBBYMds4BMB5szg7bd4o" -f optionId="$PRIORITY_OPTION_ID"

# Update Size field
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }
' -f projectId="$PROJECT_ID" -f itemId="$ITEM_ID" \
  -f fieldId="PVTSSF_lADOBBYMds4BMB5szg7bd4s" -f optionId="$SIZE_OPTION_ID"

# Update Estimate field
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { number: $number }
    }) { projectV2Item { id } }
  }
' -f projectId="$PROJECT_ID" -f itemId="$ITEM_ID" \
  -f fieldId="PVTF_lADOBBYMds4BMB5szg7bd4w" -F number="$ESTIMATE"

echo "Labels and project fields updated successfully from triage-output.json"
