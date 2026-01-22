import * as core from "@actions/core";
import * as fs from "fs";
import type { ApplyTriageOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

/**
 * Triage output JSON structure
 */
interface TriageOutput {
  type?: string;
  priority?: string | null;
  size?: string;
  estimate?: number;
  topics?: string[];
  needs_info?: boolean;
}

/**
 * Execute applyTriageOutput action
 *
 * Reads triage-output.json and applies:
 * - Labels (type, topics, triaged)
 * - Project fields (Priority, Size, Estimate)
 */
export async function executeApplyTriageOutput(
  action: ApplyTriageOutputAction,
  ctx: RunnerContext,
): Promise<{ applied: boolean }> {
  const { issueNumber, filePath } = action;

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    core.info(`No triage output file found at ${filePath} - skipping`);
    return { applied: false };
  }

  // Read and parse the file
  let triageOutput: TriageOutput;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    triageOutput = JSON.parse(content) as TriageOutput;
    core.info(`Triage output: ${JSON.stringify(triageOutput)}`);
  } catch (error) {
    core.warning(`Failed to parse triage output: ${error}`);
    return { applied: false };
  }

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply triage output to issue #${issueNumber}`);
    return { applied: true };
  }

  // Build labels array
  const labels: string[] = [];

  // Add type label
  if (triageOutput.type && triageOutput.type !== "null") {
    labels.push(triageOutput.type);
    core.info(`Adding type label: ${triageOutput.type}`);
  }

  // Add topic labels (don't double-add topic: prefix)
  if (triageOutput.topics) {
    for (const topic of triageOutput.topics) {
      if (topic) {
        const label = topic.startsWith("topic:") ? topic : `topic:${topic}`;
        labels.push(label);
        core.info(`Adding topic label: ${label}`);
      }
    }
  }

  // Add triaged label
  labels.push("triaged");
  core.info("Adding triaged label");

  // Apply labels
  if (labels.length > 0) {
    try {
      await ctx.octokit.rest.issues.addLabels({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: issueNumber,
        labels,
      });
      core.info(`Applied labels: ${labels.join(", ")}`);
    } catch (error) {
      core.warning(`Failed to apply labels: ${error}`);
    }
  }

  // Apply project fields
  await applyProjectFields(ctx, issueNumber, triageOutput);

  return { applied: true };
}

/**
 * Apply project fields (Priority, Size, Estimate)
 */
async function applyProjectFields(
  ctx: RunnerContext,
  issueNumber: number,
  triageOutput: TriageOutput,
): Promise<void> {
  try {
    // Get issue node ID and project item
    const issueQuery = `
      query($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            id
            projectItems(first: 10) {
              nodes {
                id
                project { number }
              }
            }
          }
        }
      }
    `;

    const issueResult = await ctx.octokit.graphql<{
      repository: {
        issue: {
          id: string;
          projectItems: {
            nodes: Array<{ id: string; project: { number: number } }>;
          };
        };
      };
    }>(issueQuery, {
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber,
    });

    const projectItem = issueResult.repository.issue.projectItems.nodes.find(
      (item) => item.project.number === ctx.projectNumber,
    );

    if (!projectItem) {
      core.info(`Issue #${issueNumber} not in project ${ctx.projectNumber}`);
      return;
    }

    // Get project fields
    const projectQuery = `
      query($owner: String!, $projectNumber: Int!) {
        organization(login: $owner) {
          projectV2(number: $projectNumber) {
            id
            fields(first: 30) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options { id name }
                }
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
              }
            }
          }
        }
      }
    `;

    const projectResult = await ctx.octokit.graphql<{
      organization: {
        projectV2: {
          id: string;
          fields: {
            nodes: Array<{
              id: string;
              name: string;
              dataType?: string;
              options?: Array<{ id: string; name: string }>;
            }>;
          };
        };
      };
    }>(projectQuery, {
      owner: ctx.owner,
      projectNumber: ctx.projectNumber,
    });

    const project = projectResult.organization.projectV2;
    const fields = project.fields.nodes;

    // Find fields
    const priorityField = fields.find((f) => f.name === "Priority");
    const sizeField = fields.find((f) => f.name === "Size");
    const estimateField = fields.find((f) => f.name === "Estimate");

    // Apply Priority (single select)
    if (
      priorityField?.options &&
      triageOutput.priority &&
      triageOutput.priority !== "null"
    ) {
      const option = priorityField.options.find(
        (o) => o.name.toLowerCase() === triageOutput.priority?.toLowerCase(),
      );
      if (option) {
        await updateProjectField(
          ctx,
          project.id,
          projectItem.id,
          priorityField.id,
          { singleSelectOptionId: option.id },
        );
        core.info(`Set Priority to ${option.name}`);
      }
    }

    // Apply Size (single select)
    if (sizeField?.options && triageOutput.size) {
      const option = sizeField.options.find(
        (o) => o.name.toLowerCase() === triageOutput.size?.toLowerCase(),
      );
      if (option) {
        await updateProjectField(
          ctx,
          project.id,
          projectItem.id,
          sizeField.id,
          { singleSelectOptionId: option.id },
        );
        core.info(`Set Size to ${option.name}`);
      }
    }

    // Apply Estimate (number field)
    if (estimateField && triageOutput.estimate) {
      await updateProjectField(
        ctx,
        project.id,
        projectItem.id,
        estimateField.id,
        { number: triageOutput.estimate },
      );
      core.info(`Set Estimate to ${triageOutput.estimate}`);
    }
  } catch (error) {
    core.warning(`Failed to apply project fields: ${error}`);
  }
}

/**
 * Update a project field value
 */
async function updateProjectField(
  ctx: RunnerContext,
  projectId: string,
  itemId: string,
  fieldId: string,
  value: { singleSelectOptionId?: string; number?: number },
): Promise<void> {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: $value
      }) {
        projectV2Item { id }
      }
    }
  `;

  await ctx.octokit.graphql(mutation, {
    projectId,
    itemId,
    fieldId,
    value,
  });
}
