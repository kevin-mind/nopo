/**
 * Composable steps for triage operations.
 *
 * This file demonstrates how to break down apply-triage-labels.sh
 * into atomic, type-safe workflow steps using gh-cli primitives.
 */

import { Step } from "@github-actions-workflow-ts/lib";
import {
  ghApiGraphql,
  ghIssueEdit,
  ghLabelCreate,
  ghLabelList,
  QUERY_ISSUE_PROJECT_ITEM,
  MUTATION_UPDATE_PROJECT_SINGLE_SELECT,
  MUTATION_UPDATE_PROJECT_NUMBER,
} from "./gh-cli";
import { PROJECT_FIELD_IDS } from "./project";

// =============================================================================
// Step 1: Parse Triage Output
// =============================================================================

/**
 * Step to parse triage-output.json and set outputs.
 * Outputs: type, priority, size, estimate, needs_info, topics, labels
 */
export function parseTriageOutputStep(id: string): Step {
  const script = `
# Check if triage output exists
if [[ ! -f triage-output.json ]]; then
  echo "WARNING: triage-output.json not found"
  echo "has_output=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "has_output=true" >> "$GITHUB_OUTPUT"

# Parse triage output
TYPE=$(jq -r '.type // empty' triage-output.json)
PRIORITY=$(jq -r '.priority // empty' triage-output.json)
SIZE=$(jq -r '.size // empty' triage-output.json)
ESTIMATE=$(jq -r '.estimate // 5' triage-output.json)
NEEDS_INFO=$(jq -r '.needs_info // false' triage-output.json)
TOPICS=$(jq -r '.topics // [] | join(",")' triage-output.json)

# Build labels list
LABELS="triaged"
[[ -n "$TYPE" && "$TYPE" != "null" ]] && LABELS="$LABELS,$TYPE"
[[ "$NEEDS_INFO" == "true" ]] && LABELS="$LABELS,needs-info"

# Output parsed values
echo "type=$TYPE" >> "$GITHUB_OUTPUT"
echo "priority=$PRIORITY" >> "$GITHUB_OUTPUT"
echo "size=$SIZE" >> "$GITHUB_OUTPUT"
echo "estimate=$ESTIMATE" >> "$GITHUB_OUTPUT"
echo "needs_info=$NEEDS_INFO" >> "$GITHUB_OUTPUT"
echo "topics=$TOPICS" >> "$GITHUB_OUTPUT"
echo "labels=$LABELS" >> "$GITHUB_OUTPUT"

echo "Parsed: type=$TYPE priority=$PRIORITY size=$SIZE estimate=$ESTIMATE"
`.trim();

  return new Step({
    name: "Parse triage output",
    id,
    run: script,
  });
}

// =============================================================================
// Step 2: Apply Labels
// =============================================================================

/**
 * Step to apply labels to an issue.
 */
export function applyIssueLabelsStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  LABELS: string;
}): Step {
  return new Step({
    name: "Apply labels to issue",
    env,
    run: `${ghIssueEdit({
      issue: "$ISSUE_NUMBER",
      addLabels: ["$LABELS"],
    })}`,
  });
}

// =============================================================================
// Step 3: Create Topic Labels (if needed)
// =============================================================================

/**
 * Step to create topic labels that don't exist.
 */
export function createTopicLabelsStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  TOPICS: string;
}): Step {
  const script = `
# Skip if no topics
[[ -z "$TOPICS" ]] && exit 0

IFS=',' read -ra TOPIC_ARRAY <<< "$TOPICS"
for topic in "\${TOPIC_ARRAY[@]}"; do
  [[ -z "$topic" ]] && continue
  topic_label="topic:$topic"

  # Check if label exists
  existing=$(${ghLabelList({ search: "$topic_label", json: ["name"], jq: ".[].name" })})

  if ! echo "$existing" | grep -q "^$topic_label$"; then
    echo "Creating label: $topic_label"
    ${ghLabelCreate({ name: "$topic_label", color: "7057ff", description: "Related to $topic" })} || true
  fi

  # Add to issue
  ${ghIssueEdit({ issue: "$ISSUE_NUMBER", addLabels: ["$topic_label"] })} || true
done
`.trim();

  return new Step({
    name: "Create and apply topic labels",
    env,
    run: script,
  });
}

// =============================================================================
// Step 4: Get Project Item ID
// =============================================================================

/**
 * Step to get the project item ID for an issue.
 * Outputs: item_id, project_id, has_project
 */
export function getProjectItemStep(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
    GITHUB_REPOSITORY_OWNER: string;
  },
): Step {
  const script = `
repo_name="\${GITHUB_REPOSITORY#*/}"

result=$(${ghApiGraphql({
    query: QUERY_ISSUE_PROJECT_ITEM,
    rawFields: {
      owner: "$GITHUB_REPOSITORY_OWNER",
      repo: "$repo_name",
    },
    fields: {
      number: "$ISSUE_NUMBER",
    },
  })} 2>/dev/null || echo '{}')

ITEM_ID=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].id // empty')
PROJECT_ID=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].project.id // empty')

if [[ -z "$ITEM_ID" || "$ITEM_ID" == "null" ]]; then
  echo "Issue not linked to a project"
  echo "has_project=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "has_project=true" >> "$GITHUB_OUTPUT"
echo "item_id=$ITEM_ID" >> "$GITHUB_OUTPUT"
echo "project_id=$PROJECT_ID" >> "$GITHUB_OUTPUT"
`.trim();

  return new Step({
    name: "Get project item ID",
    id,
    env,
    run: script,
  });
}

// =============================================================================
// Step 5: Update Project Priority Field
// =============================================================================

/**
 * Step to update the Priority project field.
 */
export function updateProjectPriorityStep(env: {
  GH_TOKEN: string;
  PROJECT_ID: string;
  ITEM_ID: string;
  PRIORITY: string;
}): Step {
  const script = `
# Map priority to option ID
case "$PRIORITY" in
  critical) OPTION_ID="79628723" ;;  # P0
  high)     OPTION_ID="0a877460" ;;  # P1
  *)        OPTION_ID="da944a9c" ;;  # P2
esac

${ghApiGraphql({
  query: MUTATION_UPDATE_PROJECT_SINGLE_SELECT,
  rawFields: {
    projectId: "$PROJECT_ID",
    itemId: "$ITEM_ID",
    fieldId: PROJECT_FIELD_IDS.PRIORITY,
    optionId: "$OPTION_ID",
  },
})}
`.trim();

  return new Step({
    name: "Update project Priority field",
    env,
    run: script,
  });
}

// =============================================================================
// Step 6: Update Project Size Field
// =============================================================================

/**
 * Step to update the Size project field.
 */
export function updateProjectSizeStep(env: {
  GH_TOKEN: string;
  PROJECT_ID: string;
  ITEM_ID: string;
  SIZE: string;
}): Step {
  const script = `
# Map size to option ID
case "$SIZE" in
  xs) OPTION_ID="6c6483d2" ;;
  s)  OPTION_ID="f784b110" ;;
  m)  OPTION_ID="7515a9f1" ;;
  l)  OPTION_ID="817d0097" ;;
  xl) OPTION_ID="db339eb2" ;;
  *)  OPTION_ID="7515a9f1" ;;  # Default to M
esac

${ghApiGraphql({
  query: MUTATION_UPDATE_PROJECT_SINGLE_SELECT,
  rawFields: {
    projectId: "$PROJECT_ID",
    itemId: "$ITEM_ID",
    fieldId: PROJECT_FIELD_IDS.SIZE,
    optionId: "$OPTION_ID",
  },
})}
`.trim();

  return new Step({
    name: "Update project Size field",
    env,
    run: script,
  });
}

// =============================================================================
// Step 7: Update Project Estimate Field
// =============================================================================

/**
 * Step to update the Estimate project field.
 */
export function updateProjectEstimateStep(env: {
  GH_TOKEN: string;
  PROJECT_ID: string;
  ITEM_ID: string;
  ESTIMATE: string;
}): Step {
  return new Step({
    name: "Update project Estimate field",
    env,
    run: ghApiGraphql({
      query: MUTATION_UPDATE_PROJECT_NUMBER,
      rawFields: {
        projectId: "$PROJECT_ID",
        itemId: "$ITEM_ID",
        fieldId: PROJECT_FIELD_IDS.ESTIMATE,
      },
      fields: {
        number: "$ESTIMATE",
      },
    }),
  });
}

// =============================================================================
// Combined: All triage steps as a sequence
// =============================================================================

/**
 * Returns all steps needed to apply triage labels and update project fields.
 * This replaces the monolithic apply-triage-labels.sh script.
 */
export function applyTriageSteps(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
}): Step[] {
  return [
    parseTriageOutputStep("parse"),

    // Apply labels (only if output exists)
    new Step({
      name: "Apply labels to issue",
      if: "steps.parse.outputs.has_output == 'true'",
      env: {
        ...env,
        LABELS: "${{ steps.parse.outputs.labels }}",
      },
      run: ghIssueEdit({
        issue: "$ISSUE_NUMBER",
        addLabels: ["$LABELS"],
      }),
    }),

    // Create topic labels
    new Step({
      name: "Create and apply topic labels",
      if: "steps.parse.outputs.has_output == 'true' && steps.parse.outputs.topics != ''",
      env: {
        ...env,
        TOPICS: "${{ steps.parse.outputs.topics }}",
      },
      run: `
IFS=',' read -ra TOPIC_ARRAY <<< "$TOPICS"
for topic in "\${TOPIC_ARRAY[@]}"; do
  [[ -z "$topic" ]] && continue
  topic_label="topic:$topic"
  ${ghLabelCreate({ name: "$topic_label", color: "7057ff", description: "Related to $topic" })} || true
  ${ghIssueEdit({ issue: "$ISSUE_NUMBER", addLabels: ["$topic_label"] })} || true
done
`.trim(),
    }),

    // Get project item
    getProjectItemStep("project", {
      ...env,
      GITHUB_REPOSITORY_OWNER: "${{ github.repository_owner }}",
    }),

    // Update priority
    new Step({
      name: "Update project Priority",
      if: "steps.project.outputs.has_project == 'true'",
      env: {
        ...env,
        PROJECT_ID: "${{ steps.project.outputs.project_id }}",
        ITEM_ID: "${{ steps.project.outputs.item_id }}",
        PRIORITY: "${{ steps.parse.outputs.priority }}",
      },
      run: `
case "$PRIORITY" in
  critical) OPTION_ID="79628723" ;;
  high)     OPTION_ID="0a877460" ;;
  *)        OPTION_ID="da944a9c" ;;
esac
${ghApiGraphql({
  query: MUTATION_UPDATE_PROJECT_SINGLE_SELECT,
  rawFields: {
    projectId: "$PROJECT_ID",
    itemId: "$ITEM_ID",
    fieldId: PROJECT_FIELD_IDS.PRIORITY,
    optionId: "$OPTION_ID",
  },
})}
`.trim(),
    }),

    // Update size
    new Step({
      name: "Update project Size",
      if: "steps.project.outputs.has_project == 'true'",
      env: {
        ...env,
        PROJECT_ID: "${{ steps.project.outputs.project_id }}",
        ITEM_ID: "${{ steps.project.outputs.item_id }}",
        SIZE: "${{ steps.parse.outputs.size }}",
      },
      run: `
case "$SIZE" in
  xs) OPTION_ID="6c6483d2" ;;
  s)  OPTION_ID="f784b110" ;;
  m)  OPTION_ID="7515a9f1" ;;
  l)  OPTION_ID="817d0097" ;;
  xl) OPTION_ID="db339eb2" ;;
  *)  OPTION_ID="7515a9f1" ;;
esac
${ghApiGraphql({
  query: MUTATION_UPDATE_PROJECT_SINGLE_SELECT,
  rawFields: {
    projectId: "$PROJECT_ID",
    itemId: "$ITEM_ID",
    fieldId: PROJECT_FIELD_IDS.SIZE,
    optionId: "$OPTION_ID",
  },
})}
`.trim(),
    }),

    // Update estimate
    new Step({
      name: "Update project Estimate",
      if: "steps.project.outputs.has_project == 'true'",
      env: {
        ...env,
        PROJECT_ID: "${{ steps.project.outputs.project_id }}",
        ITEM_ID: "${{ steps.project.outputs.item_id }}",
        ESTIMATE: "${{ steps.parse.outputs.estimate }}",
      },
      run: ghApiGraphql({
        query: MUTATION_UPDATE_PROJECT_NUMBER,
        rawFields: {
          projectId: "$PROJECT_ID",
          itemId: "$ITEM_ID",
          fieldId: PROJECT_FIELD_IDS.ESTIMATE,
        },
        fields: {
          number: "$ESTIMATE",
        },
      }),
    }),
  ];
}
