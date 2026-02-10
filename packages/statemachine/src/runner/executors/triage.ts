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
  parseIssue,
  createComment,
  parseMarkdown,
  serializeMarkdown,
  type OctokitLike,
} from "@more/issue-state";
import type { Root, RootContent } from "mdast";
import type { ApplyTriageOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { replaceBody } from "../../parser/index.js";
import {
  TriageOutputSchema,
  LegacyTriageOutputSchema,
  parseOutput,
  type TriageOutput,
  type LegacyTriageOutput,
  type TriageClassification,
} from "./output-schemas.js";

// Helper to cast RunnerContext octokit to OctokitLike

function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
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

  // Parse raw data from structured output or file
  let rawData: unknown;

  if (structuredOutput) {
    rawData = structuredOutput;
    core.info("Using structured output from in-process chain");
    core.startGroup("Triage Output (Structured)");
    core.info(JSON.stringify(rawData, null, 2));
    core.endGroup();
  } else if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      rawData = JSON.parse(content);
      core.info(`Triage output from file: ${filePath}`);
      core.startGroup("Triage Output (File)");
      core.info(JSON.stringify(rawData, null, 2));
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

  // Try new format first, fall back to legacy
  const newFormatResult = TriageOutputSchema.safeParse(rawData);
  const isNewFormat = newFormatResult.success;

  let classification: TriageClassification;
  let newFormatOutput: TriageOutput | null = null;
  let legacyOutput: LegacyTriageOutput | null = null;

  if (isNewFormat) {
    newFormatOutput = newFormatResult.data;
    classification = newFormatOutput.triage;
  } else {
    // Try legacy format
    legacyOutput = parseOutput(
      LegacyTriageOutputSchema,
      rawData,
      "triage (legacy)",
    );
    classification = {
      type: legacyOutput.type || "enhancement",
      priority: legacyOutput.priority,
      size: legacyOutput.size || "m",
      estimate: legacyOutput.estimate || 5,
      topics: legacyOutput.topics || [],
      needs_info: legacyOutput.needs_info || false,
    };
  }

  // 1. Apply labels
  await applyLabels(ctx, issueNumber, classification);

  // 2. Apply project fields
  await applyProjectFields(ctx, issueNumber, classification);

  // 3. Update issue body with structured sections (new format only)
  if (newFormatOutput) {
    await updateIssueStructure(
      ctx,
      issueNumber,
      newFormatOutput.requirements,
      newFormatOutput.initial_approach,
      newFormatOutput.initial_questions,
    );
  } else if (legacyOutput?.issue_body) {
    await updateIssueBody(ctx, issueNumber, legacyOutput.issue_body);
  }

  // 4. Link related issues
  const relatedIssues =
    newFormatOutput?.related_issues || legacyOutput?.related_issues;
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
  const newLabels: string[] = [];

  // Add type label
  if (classification.type && classification.type !== "null") {
    newLabels.push(classification.type);
    core.info(`Adding type label: ${classification.type}`);
  }

  // Add topic labels (don't double-add topic: prefix)
  if (classification.topics) {
    for (const topic of classification.topics) {
      if (topic) {
        const label = topic.startsWith("topic:") ? topic : `topic:${topic}`;
        newLabels.push(label);
        core.info(`Adding topic label: ${label}`);
      }
    }
  }

  // Add triaged label
  newLabels.push("triaged");
  core.info("Adding triaged label");

  // Apply labels via parseIssue + update
  if (newLabels.length > 0) {
    try {
      const { data, update } = await parseIssue(
        ctx.owner,
        ctx.repo,
        issueNumber,
        {
          octokit: asOctokitLike(ctx),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const existingLabels = data.issue.labels;
      const mergedLabels = [...new Set([...existingLabels, ...newLabels])];
      const state = { ...data, issue: { ...data.issue, labels: mergedLabels } };
      await update(state);
      core.info(`Applied labels: ${newLabels.join(", ")}`);
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
    const { data, update } = await parseIssue(
      ctx.owner,
      ctx.repo,
      issueNumber,
      {
        octokit: asOctokitLike(ctx),
        fetchPRs: false,
        fetchParent: false,
      },
    );
    const bodyAst = parseMarkdown(newBody);
    const state = replaceBody({ bodyAst }, data);
    await update(state);
    core.info(`Updated issue body for #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to update issue body: ${error}`);
  }
}

/**
 * Extract nodes belonging to preserved sections (Iteration History, Agent Notes).
 * Returns MDAST nodes including section headings and all content until the next
 * non-preserved depth-2 heading.
 */
function extractPreservedSections(ast: Root): RootContent[] {
  const preserved: RootContent[] = [];
  const preservedHeadings = new Set(["Iteration History", "Agent Notes"]);
  let inPreserved = false;

  for (const node of ast.children) {
    if (node.type === "heading" && node.depth === 2) {
      const firstChild = node.children[0];
      const text = firstChild?.type === "text" ? firstChild.value : "";
      inPreserved = preservedHeadings.has(text);
    }
    if (inPreserved) {
      preserved.push(node);
    }
  }

  return preserved;
}

/**
 * Replace the issue body with structured sections from triage output.
 *
 * Builds a fresh body from Requirements, Approach, and Questions sections,
 * preserving only Iteration History and Agent Notes from the existing body.
 * Sets the body directly via API to avoid remark-stringify escaping underscores
 * and brackets in text nodes (e.g. depends_on → depends\_on).
 */
async function updateIssueStructure(
  ctx: RunnerContext,
  issueNumber: number,
  requirements: string[],
  initialApproach: string,
  initialQuestions?: string[],
): Promise<void> {
  try {
    const { data } = await parseIssue(ctx.owner, ctx.repo, issueNumber, {
      octokit: asOctokitLike(ctx),
      fetchPRs: false,
      fetchParent: false,
    });

    // Build new body as raw markdown strings.
    const sections: string[] = [];

    if (requirements.length > 0) {
      sections.push(
        `## Requirements\n\n${requirements.map((r) => `- ${r}`).join("\n")}`,
      );
    }

    if (initialApproach) {
      sections.push(`## Approach\n\n${initialApproach}`);
    }

    if (initialQuestions && initialQuestions.length > 0) {
      const questionLines = initialQuestions
        .map((q) => `- [ ] ${q}`)
        .join("\n");
      sections.push(`## Questions\n\n${questionLines}`);
    }

    // Serialize preserved sections (Iteration History, Agent Notes) from
    // existing MDAST. These sections contain tables/links that serialize fine.
    const preservedNodes = extractPreservedSections(data.issue.bodyAst);
    let preservedMarkdown = "";
    if (preservedNodes.length > 0) {
      const preservedAst: Root = { type: "root", children: preservedNodes };
      preservedMarkdown = serializeMarkdown(preservedAst);
    }

    // Combine into final body — bypass MDAST round-trip to avoid escaping
    const newBody = [sections.join("\n\n"), preservedMarkdown]
      .filter(Boolean)
      .join("\n\n");

    // Set body directly via API to preserve original markdown formatting
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
    await createComment(
      ctx.owner,
      ctx.repo,
      issueNumber,
      body,
      asOctokitLike(ctx),
    );
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
