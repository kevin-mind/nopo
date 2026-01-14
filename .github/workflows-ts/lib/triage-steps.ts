/**
 * Composable steps for triage operations.
 *
 * Uses atomic step generators from cli/gh.ts to build the triage workflow.
 */

import { Step } from "@github-actions-workflow-ts/lib";
import {
  parseTriageOutput,
  ghIssueEditAddLabel,
  ghApplyTopicLabels,
  ghApiGetProjectItem,
  ghApiUpdateProjectPriority,
  ghApiUpdateProjectSize,
  ghApiUpdateProjectEstimate,
} from "./cli/gh";

/**
 * Returns all steps needed to apply triage labels and update project fields.
 * This composes atomic steps from cli/gh.ts into a sequence.
 */
export function applyTriageSteps(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
}): Step[] {
  return [
    // Step 1: Parse triage output JSON
    parseTriageOutput("parse"),

    // Step 2: Apply labels (only if output exists)
    {
      ...ghIssueEditAddLabel({
        ...env,
        LABELS: "${{ steps.parse.outputs.labels }}",
      }),
      if: "steps.parse.outputs.has_output == 'true'",
    } as Step,

    // Step 3: Create and apply topic labels
    {
      ...ghApplyTopicLabels({
        ...env,
        TOPICS: "${{ steps.parse.outputs.topics }}",
      }),
      if: "steps.parse.outputs.has_output == 'true' && steps.parse.outputs.topics != ''",
    } as Step,

    // Step 4: Get project item
    ghApiGetProjectItem("project", env),

    // Step 5: Update priority
    {
      ...ghApiUpdateProjectPriority({
        ...env,
        PROJECT_ID: "${{ steps.project.outputs.project_id }}",
        ITEM_ID: "${{ steps.project.outputs.item_id }}",
        PRIORITY: "${{ steps.parse.outputs.priority }}",
      }),
      if: "steps.project.outputs.has_project == 'true'",
    } as Step,

    // Step 6: Update size
    {
      ...ghApiUpdateProjectSize({
        ...env,
        PROJECT_ID: "${{ steps.project.outputs.project_id }}",
        ITEM_ID: "${{ steps.project.outputs.item_id }}",
        SIZE: "${{ steps.parse.outputs.size }}",
      }),
      if: "steps.project.outputs.has_project == 'true'",
    } as Step,

    // Step 7: Update estimate
    {
      ...ghApiUpdateProjectEstimate({
        ...env,
        PROJECT_ID: "${{ steps.project.outputs.project_id }}",
        ITEM_ID: "${{ steps.project.outputs.item_id }}",
        ESTIMATE: "${{ steps.parse.outputs.estimate }}",
      }),
      if: "steps.project.outputs.has_project == 'true'",
    } as Step,
  ];
}
