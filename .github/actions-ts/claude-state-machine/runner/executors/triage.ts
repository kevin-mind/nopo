import * as core from "@actions/core";
import * as fs from "fs";
import type { ApplyTriageOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// GraphQL Queries
// ============================================================================

const GET_REPO_ID_QUERY = `
query GetRepoId($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
  }
}
`;

const GET_ISSUE_ID_QUERY = `
query GetIssueId($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
    }
  }
}
`;

const CREATE_ISSUE_MUTATION = `
mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String!) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
    issue {
      id
      number
    }
  }
}
`;

const ADD_SUB_ISSUE_MUTATION = `
mutation AddSubIssue($parentId: ID!, $childId: ID!) {
  addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
    issue {
      id
    }
  }
}
`;

const ADD_ISSUE_TO_PROJECT_MUTATION = `
mutation AddIssueToProject($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: {
    projectId: $projectId
    contentId: $contentId
  }) {
    item {
      id
    }
  }
}
`;

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
 * Todo item from structured output
 */
interface TodoItem {
  task: string;
  manual: boolean;
}

/**
 * Sub-issue definition from structured output
 */
interface SubIssueDefinition {
  type: string;
  title: string;
  description: string;
  todos: TodoItem[] | string[]; // Support both new and legacy format
}

/**
 * Full triage output JSON structure (structured output schema)
 */
interface TriageOutput {
  triage: TriageClassification;
  issue_body: string;
  sub_issues: SubIssueDefinition[];
  related_issues?: number[];
  agent_notes?: string[];
}

/**
 * Legacy triage output format (for backwards compatibility)
 */
interface LegacyTriageOutput {
  type?: string;
  priority?: string | null;
  size?: string;
  estimate?: number;
  topics?: string[];
  needs_info?: boolean;
}

interface RepoIdResponse {
  repository?: {
    id?: string;
  };
}

interface IssueIdResponse {
  repository?: {
    issue?: {
      id?: string;
    };
  };
}

interface CreateIssueResponse {
  createIssue?: {
    issue?: {
      id?: string;
      number?: number;
    };
  };
}

interface AddToProjectResponse {
  addProjectV2ItemById?: {
    item?: {
      id?: string;
    };
  };
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
 * - Uses triage.issue_body for updated body
 * - Uses triage.sub_issues to create sub-issues with todos
 * - Uses triage.related_issues to link related issues
 *
 * Applies:
 * - Labels (type, topics, triaged)
 * - Project fields (Priority, Size, Estimate)
 * - Updated issue body
 * - Sub-issues with todos
 * - Related issue links
 */
export async function executeApplyTriageOutput(
  action: ApplyTriageOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; subIssueNumbers?: number[] }> {
  const { issueNumber, filePath } = action;

  let triageOutput: TriageOutput | LegacyTriageOutput;

  // Try structured output first (in-process chaining), then fall back to file
  if (structuredOutput) {
    triageOutput = structuredOutput as TriageOutput;
    core.info("Using structured output from in-process chain");
    core.startGroup("Triage Output (Structured)");
    core.info(JSON.stringify(triageOutput, null, 2));
    core.endGroup();
  } else if (filePath && fs.existsSync(filePath)) {
    // Read from file (artifact passed between workflow matrix jobs)
    try {
      const content = fs.readFileSync(filePath, "utf-8");
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
  const isStructured = "triage" in triageOutput;
  const classification: TriageClassification = isStructured
    ? (triageOutput as TriageOutput).triage
    : {
        type: (triageOutput as LegacyTriageOutput).type || "enhancement",
        priority: (triageOutput as LegacyTriageOutput).priority,
        size: (triageOutput as LegacyTriageOutput).size || "m",
        estimate: (triageOutput as LegacyTriageOutput).estimate || 5,
        topics: (triageOutput as LegacyTriageOutput).topics || [],
        needs_info: (triageOutput as LegacyTriageOutput).needs_info || false,
      };

  // 1. Apply labels
  await applyLabels(ctx, issueNumber, classification);

  // 2. Apply project fields
  await applyProjectFields(ctx, issueNumber, classification);

  // 3. Update issue body (structured output only)
  if (isStructured && (triageOutput as TriageOutput).issue_body) {
    await updateIssueBody(
      ctx,
      issueNumber,
      (triageOutput as TriageOutput).issue_body,
    );
  }

  // 4. Create sub-issues (structured output only)
  let subIssueNumbers: number[] = [];
  if (isStructured && (triageOutput as TriageOutput).sub_issues?.length > 0) {
    subIssueNumbers = await createSubIssues(
      ctx,
      issueNumber,
      (triageOutput as TriageOutput).sub_issues,
    );
  }

  // 5. Link related issues (structured output only)
  if (isStructured && (triageOutput as TriageOutput).related_issues?.length) {
    await linkRelatedIssues(
      ctx,
      issueNumber,
      (triageOutput as TriageOutput).related_issues || [],
    );
  }

  return { applied: true, subIssueNumbers };
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
 * Update the issue body
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

// ============================================================================
// Sub-Issue Creation
// ============================================================================

/**
 * Create sub-issues from the structured output
 * Returns array of created issue numbers
 */
async function createSubIssues(
  ctx: RunnerContext,
  parentIssueNumber: number,
  subIssues: SubIssueDefinition[],
): Promise<number[]> {
  // Get repository ID
  const repoResponse = await ctx.octokit.graphql<RepoIdResponse>(
    GET_REPO_ID_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
    },
  );

  const repoId = repoResponse.repository?.id;
  if (!repoId) {
    throw new Error("Repository not found");
  }

  // Get parent issue ID
  const parentResponse = await ctx.octokit.graphql<IssueIdResponse>(
    GET_ISSUE_ID_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: parentIssueNumber,
    },
  );

  const parentId = parentResponse.repository?.issue?.id;
  if (!parentId) {
    throw new Error(`Parent issue #${parentIssueNumber} not found`);
  }

  // Get project info for adding sub-issues to project
  const projectInfo = await getProjectInfo(ctx);

  const subIssueNumbers: number[] = [];

  for (let i = 0; i < subIssues.length; i++) {
    const subIssue = subIssues[i];
    if (!subIssue) continue;

    // Format title with phase number (1-indexed)
    const phaseNumber = i + 1;
    const formattedTitle =
      subIssues.length > 1
        ? `[Phase ${phaseNumber}] ${subIssue.title}`
        : subIssue.title;

    // Build the sub-issue body with todos
    // Support both new format (object with task/manual) and legacy format (string)
    const todoList = subIssue.todos
      .map((todo) => {
        if (typeof todo === "string") {
          // Legacy format: plain string
          return `- [ ] ${todo}`;
        } else {
          // New format: object with task and manual flag
          const prefix = todo.manual ? "[Manual] " : "";
          return `- [ ] ${prefix}${todo.task}`;
        }
      })
      .join("\n");

    const body = `## Description

${subIssue.description}

## Todo

${todoList}

---

Parent: #${parentIssueNumber}`;

    // Create the sub-issue
    const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
      CREATE_ISSUE_MUTATION,
      {
        repositoryId: repoId,
        title: formattedTitle,
        body,
      },
    );

    const issueId = createResponse.createIssue?.issue?.id;
    const issueNumber = createResponse.createIssue?.issue?.number;

    if (!issueId || !issueNumber) {
      throw new Error(`Failed to create sub-issue for phase ${i + 1}`);
    }

    // Link as sub-issue
    await ctx.octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
      parentId,
      childId: issueId,
    });

    // Add "triaged" label and type label to sub-issue
    const subIssueLabels = ["triaged"];
    if (subIssue.type) {
      subIssueLabels.push(subIssue.type);
    }
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: subIssueLabels,
    });

    // Add to project with "Ready" status
    if (projectInfo) {
      await addToProjectWithStatus(ctx, issueId, projectInfo, "Ready");
    }

    subIssueNumbers.push(issueNumber);
    core.info(`Created sub-issue #${issueNumber}: ${formattedTitle}`);
  }

  return subIssueNumbers;
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

const GET_PROJECT_FIELDS_QUERY = `
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

const UPDATE_PROJECT_FIELD_MUTATION = `
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
 * Add an issue to the project with a specific status
 */
async function addToProjectWithStatus(
  ctx: RunnerContext,
  issueNodeId: string,
  projectInfo: ProjectInfo,
  status: string,
): Promise<void> {
  try {
    // Add to project
    const addResult = await ctx.octokit.graphql<AddToProjectResponse>(
      ADD_ISSUE_TO_PROJECT_MUTATION,
      {
        projectId: projectInfo.projectId,
        contentId: issueNodeId,
      },
    );

    const itemId = addResult.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      core.warning("Failed to add issue to project");
      return;
    }

    // Set status
    const statusOptionId = projectInfo.statusOptions[status];
    if (statusOptionId && projectInfo.statusFieldId) {
      await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectInfo.projectId,
        itemId,
        fieldId: projectInfo.statusFieldId,
        value: { singleSelectOptionId: statusOptionId },
      });
      core.info(`Set project status to ${status}`);
    }
  } catch (error) {
    core.warning(`Failed to add issue to project with status: ${error}`);
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
    if (
      classification.priority &&
      classification.priority !== "null" &&
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
