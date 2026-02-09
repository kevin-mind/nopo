/**
 * Triage Executor
 *
 * Processes Claude's structured output from triage actions.
 */

import * as core from "@actions/core";
import * as fs from "fs";
import {
  GET_PROJECT_FIELDS_QUERY,
  UPDATE_PROJECT_FIELD_MUTATION,
} from "@more/issue-state";
import type { ApplyTriageOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import {
  upsertSections,
  formatRequirements,
  STANDARD_SECTION_ORDER,
} from "@more/issue-state";

// ============================================================================
// Types
// ============================================================================

/**
 * Triage classification from structured output
 */
interface TriageClassification {
  type: string;
  priority?: string | null;
  size: string;
  estimate: number;
  topics: string[];
  needs_info: boolean;
}

/**
 * Full triage output JSON structure (new structured output schema)
 * Note: Sub-issues are no longer created during triage - they are created during grooming
 */
interface TriageOutput {
  triage: TriageClassification;
  requirements: string[];
  initial_approach: string;
  initial_questions?: string[];
  related_issues?: number[];
  agent_notes?: string[];
}

/**
 * Legacy triage output format (for backwards compatibility)
 * This format is still supported for existing workflows
 */
interface LegacyTriageOutput {
  type?: string;
  priority?: string | null;
  size?: string;
  estimate?: number;
  topics?: string[];
  needs_info?: boolean;
  // Legacy sub-issues support for backward compatibility
  sub_issues?: Array<{
    type: string;
    title: string;
    description: string;
    todos: Array<{ task: string; manual: boolean } | string>;
  }>;
  issue_body?: string;
  related_issues?: number[];
}

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute applyTriageOutput action
 *
 * Handles both new structured output format and legacy file-based format.
 *
 * For structured output (new style):
 * - Uses triage.triage for classification
 * - Uses triage.requirements to update Requirements section
 * - Uses triage.initial_approach to update Approach section
 * - Uses triage.initial_questions to update Questions section
 * - Uses triage.related_issues to link related issues
 *
 * Applies:
 * - Labels (type, topics, triaged)
 * - Project fields (Priority, Size, Estimate)
 * - Updates issue body with structured sections
 * - Links related issues
 *
 * NOTE: Sub-issues are NO LONGER created during triage.
 * They are created during grooming after the issue is fully refined.
 */
export async function executeApplyTriageOutput(
  action: ApplyTriageOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean }> {
  const { issueNumber, filePath } = action;

  let triageOutput: TriageOutput | LegacyTriageOutput;

  // Try structured output first (in-process chaining), then fall back to file
  if (structuredOutput) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- structured output from Claude SDK is typed as unknown
    triageOutput = structuredOutput as TriageOutput;
    core.info("Using structured output from in-process chain");
    core.startGroup("Triage Output (Structured)");
    core.info(JSON.stringify(triageOutput, null, 2));
    core.endGroup();
  } else if (filePath && fs.existsSync(filePath)) {
    // Read from file (artifact passed between workflow matrix jobs)
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, file content matches triage output schemas
      triageOutput = JSON.parse(content) as TriageOutput | LegacyTriageOutput;
      core.info(`Triage output from file: ${filePath}`);
      core.startGroup("Triage Output (File)");
      core.info(JSON.stringify(triageOutput, null, 2));
      core.endGroup();
    } catch (error) {
      core.warning(`Failed to parse triage output: ${error}`);
      return { applied: false };
    }
  } else {
    throw new Error(
      `No structured output provided and triage output file not found at: ${filePath || "undefined"}. ` +
        "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
    );
  }

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply triage output to issue #${issueNumber}`);
    return { applied: true };
  }

  // Detect output format and extract classification
  const isNewFormat =
    "triage" in triageOutput && "requirements" in triageOutput;
  const isLegacyStructured =
    "triage" in triageOutput && !("requirements" in triageOutput);

  const classification: TriageClassification =
    isNewFormat || isLegacyStructured
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed to new/legacy structured format by conditional
        (triageOutput as TriageOutput).triage
      : {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed to legacy format by else branch
          type: (triageOutput as LegacyTriageOutput).type || "enhancement",
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed to legacy format by else branch
          priority: (triageOutput as LegacyTriageOutput).priority,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed to legacy format by else branch
          size: (triageOutput as LegacyTriageOutput).size || "m",
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed to legacy format by else branch
          estimate: (triageOutput as LegacyTriageOutput).estimate || 5,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed to legacy format by else branch
          topics: (triageOutput as LegacyTriageOutput).topics || [],
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowed to legacy format by else branch
          needs_info: (triageOutput as LegacyTriageOutput).needs_info || false,
        };

  // 1. Apply labels
  await applyLabels(ctx, issueNumber, classification);

  // 2. Apply project fields
  await applyProjectFields(ctx, issueNumber, classification);

  // 3. Update issue body with structured sections (new format only)
  if (isNewFormat) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- isNewFormat check above confirms this is TriageOutput
    const newFormatOutput = triageOutput as TriageOutput;
    await updateIssueStructure(
      ctx,
      issueNumber,
      newFormatOutput.requirements,
      newFormatOutput.initial_approach,
      newFormatOutput.initial_questions,
    );
  } else if (isLegacyStructured) {
    // Legacy format with issue_body - still update the body directly
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- isLegacyStructured check above confirms this is LegacyTriageOutput
    const legacyOutput = triageOutput as LegacyTriageOutput;
    if (legacyOutput.issue_body) {
      await updateIssueBody(ctx, issueNumber, legacyOutput.issue_body);
    }
  }

  // 4. Link related issues
  const relatedIssues =
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- accessing related_issues from either format
    (triageOutput as TriageOutput).related_issues ||
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- accessing related_issues from either format
    (triageOutput as LegacyTriageOutput).related_issues;
  if (relatedIssues && relatedIssues.length > 0) {
    await linkRelatedIssues(ctx, issueNumber, relatedIssues);
  }

  return { applied: true };
}

// ============================================================================
// Label Application
// ============================================================================

/**
 * Apply labels based on triage classification
 */
async function applyLabels(
  ctx: RunnerContext,
  issueNumber: number,
  classification: TriageClassification,
): Promise<void> {
  const labels: string[] = [];

  // Add type label
  if (classification.type && classification.type !== "null") {
    labels.push(classification.type);
    core.info(`Adding type label: ${classification.type}`);
  }

  // Add topic labels (don't double-add topic: prefix)
  if (classification.topics) {
    for (const topic of classification.topics) {
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
}

// ============================================================================
// Issue Body Update
// ============================================================================

/**
 * Update the issue body (legacy - used for backward compatibility)
 */
async function updateIssueBody(
  ctx: RunnerContext,
  issueNumber: number,
  newBody: string,
): Promise<void> {
  try {
    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body: newBody,
    });
    core.info(`Updated issue body for #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to update issue body: ${error}`);
  }
}

/**
 * Update issue body with structured sections from triage output
 *
 * This adds/updates Requirements, Approach, and Questions sections
 * while preserving existing content like Agent Notes and Iteration History.
 */
async function updateIssueStructure(
  ctx: RunnerContext,
  issueNumber: number,
  requirements: string[],
  initialApproach: string,
  initialQuestions?: string[],
): Promise<void> {
  try {
    // Get current issue body
    const { data: issue } = await ctx.octokit.rest.issues.get({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
    });

    const currentBody = issue.body || "";

    // Build sections to update
    const sections: Array<{ name: string; content: string }> = [];

    // Requirements section
    if (requirements.length > 0) {
      sections.push({
        name: "Requirements",
        content: formatRequirements(requirements),
      });
    }

    // Approach section
    if (initialApproach) {
      sections.push({
        name: "Approach",
        content: initialApproach,
      });
    }

    // Questions section (if any)
    if (initialQuestions && initialQuestions.length > 0) {
      const questionsContent = initialQuestions
        .map((q) => `- [ ] ${q}`)
        .join("\n");
      sections.push({
        name: "Questions",
        content: questionsContent,
      });
    }

    // Update sections while preserving order and existing content
    const newBody = upsertSections(
      currentBody,
      sections,
      STANDARD_SECTION_ORDER,
    );

    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body: newBody,
    });

    core.info(`Updated issue #${issueNumber} with structured sections`);
  } catch (error) {
    core.warning(`Failed to update issue structure: ${error}`);
  }
}

// ============================================================================
// Related Issues Linking
// ============================================================================

/**
 * Link related issues by adding a comment
 */
async function linkRelatedIssues(
  ctx: RunnerContext,
  issueNumber: number,
  relatedIssues: number[],
): Promise<void> {
  if (relatedIssues.length === 0) return;

  const links = relatedIssues.map((num) => `#${num}`).join(", ");
  const body = `**Related issues:** ${links}`;

  try {
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
    core.info(`Linked related issues: ${links}`);
  } catch (error) {
    core.warning(`Failed to link related issues: ${error}`);
  }
}

// ============================================================================
// Project Fields
// ============================================================================

interface ProjectInfo {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  priorityFieldId: string;
  priorityOptions: Record<string, string>;
  sizeFieldId: string;
  sizeOptions: Record<string, string>;
  estimateFieldId: string;
}

/**
 * Get project info (fields, options) for the configured project
 */
async function getProjectInfo(ctx: RunnerContext): Promise<ProjectInfo | null> {
  try {
    const result = await ctx.octokit.graphql<{
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
    }>(GET_PROJECT_FIELDS_QUERY, {
      owner: ctx.owner,
      projectNumber: ctx.projectNumber,
    });

    const project = result.organization.projectV2;
    const fields = project.fields.nodes;

    const projectInfo: ProjectInfo = {
      projectId: project.id,
      statusFieldId: "",
      statusOptions: {},
      priorityFieldId: "",
      priorityOptions: {},
      sizeFieldId: "",
      sizeOptions: {},
      estimateFieldId: "",
    };

    for (const field of fields) {
      if (!field) continue;
      if (field.name === "Status" && field.options) {
        projectInfo.statusFieldId = field.id;
        for (const option of field.options) {
          projectInfo.statusOptions[option.name] = option.id;
        }
      } else if (field.name === "Priority" && field.options) {
        projectInfo.priorityFieldId = field.id;
        for (const option of field.options) {
          projectInfo.priorityOptions[option.name.toLowerCase()] = option.id;
        }
      } else if (field.name === "Size" && field.options) {
        projectInfo.sizeFieldId = field.id;
        for (const option of field.options) {
          projectInfo.sizeOptions[option.name.toLowerCase()] = option.id;
        }
      } else if (field.name === "Estimate") {
        projectInfo.estimateFieldId = field.id;
      }
    }

    return projectInfo;
  } catch (error) {
    core.warning(`Failed to get project info: ${error}`);
    return null;
  }
}

/**
 * Apply project fields (Priority, Size, Estimate)
 */
async function applyProjectFields(
  ctx: RunnerContext,
  issueNumber: number,
  classification: TriageClassification,
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

    // Get project info
    const projectInfo = await getProjectInfo(ctx);
    if (!projectInfo) {
      core.warning("Could not get project info");
      return;
    }

    // Apply Priority (single select)
    // Skip if priority is null, "null", or "none"
    if (
      classification.priority &&
      classification.priority !== "null" &&
      classification.priority !== "none" &&
      projectInfo.priorityFieldId
    ) {
      const optionId =
        projectInfo.priorityOptions[classification.priority.toLowerCase()];
      if (optionId) {
        await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectInfo.projectId,
          itemId: projectItem.id,
          fieldId: projectInfo.priorityFieldId,
          value: { singleSelectOptionId: optionId },
        });
        core.info(`Set Priority to ${classification.priority}`);
      }
    }

    // Apply Size (single select)
    if (classification.size && projectInfo.sizeFieldId) {
      const optionId =
        projectInfo.sizeOptions[classification.size.toLowerCase()];
      if (optionId) {
        await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectInfo.projectId,
          itemId: projectItem.id,
          fieldId: projectInfo.sizeFieldId,
          value: { singleSelectOptionId: optionId },
        });
        core.info(`Set Size to ${classification.size}`);
      }
    }

    // Apply Estimate (number field)
    if (classification.estimate && projectInfo.estimateFieldId) {
      await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectInfo.projectId,
        itemId: projectItem.id,
        fieldId: projectInfo.estimateFieldId,
        value: { number: classification.estimate },
      });
      core.info(`Set Estimate to ${classification.estimate}`);
    }
  } catch (error) {
    core.warning(`Failed to apply project fields: ${error}`);
  }
}
