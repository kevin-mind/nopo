import type { GitHub } from "@actions/github/lib/utils.js";
import * as core from "@actions/core";
import type {
  UpdateProjectStatusAction,
  IncrementIterationAction,
  RecordFailureAction,
  ClearFailuresAction,
  BlockAction,
  ProjectStatus,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// GraphQL Queries
// ============================================================================

const GET_PROJECT_ITEM_QUERY = `
query GetProjectItem($org: String!, $repo: String!, $issueNumber: Int!, $projectNumber: Int!) {
  repository(owner: $org, name: $repo) {
    issue(number: $issueNumber) {
      id
      projectItems(first: 10) {
        nodes {
          id
          project {
            id
            number
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                    id
                  }
                }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field {
                  ... on ProjectV2Field {
                    name
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  organization(login: $org) {
    projectV2(number: $projectNumber) {
      id
      fields(first: 20) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
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
mutation UpdateProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: $value
  }) {
    projectV2Item {
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

interface ProjectFields {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  iterationFieldId: string;
  failuresFieldId: string;
}

interface ProjectFieldValue {
  name?: string;
  number?: number;
  field?: { name?: string; id?: string };
}

interface ProjectItemNode {
  id?: string;
  project?: { id?: string; number?: number };
  fieldValues?: { nodes?: ProjectFieldValue[] };
}

interface ProjectState {
  status: ProjectStatus | null;
  iteration: number;
  failures: number;
}

interface QueryResponse {
  repository?: {
    issue?: {
      id?: string;
      projectItems?: { nodes?: ProjectItemNode[] };
    };
  };
  organization?: {
    projectV2?: {
      id?: string;
      fields?: {
        nodes?: Array<{
          id?: string;
          name?: string;
          options?: Array<{ id: string; name: string }>;
          dataType?: string;
        }>;
      };
    };
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseProjectFields(projectData: unknown): ProjectFields | null {
  const project = projectData as QueryResponse["organization"];
  if (!project?.projectV2?.id || !project.projectV2.fields?.nodes) {
    return null;
  }

  const fields: ProjectFields = {
    projectId: project.projectV2.id,
    statusFieldId: "",
    statusOptions: {},
    iterationFieldId: "",
    failuresFieldId: "",
  };

  for (const field of project.projectV2.fields.nodes) {
    if (!field) continue;
    if (field.name === "Status" && field.options) {
      fields.statusFieldId = field.id || "";
      for (const option of field.options) {
        fields.statusOptions[option.name] = option.id;
      }
    } else if (field.name === "Iteration") {
      fields.iterationFieldId = field.id || "";
    } else if (field.name === "Failures") {
      fields.failuresFieldId = field.id || "";
    }
  }

  return fields;
}

function findStatusOption(
  statusOptions: Record<string, string>,
  status: string,
): string | undefined {
  if (statusOptions[status]) {
    return statusOptions[status];
  }
  const lowerStatus = status.toLowerCase();
  for (const [name, id] of Object.entries(statusOptions)) {
    if (name.toLowerCase() === lowerStatus) {
      return id;
    }
  }
  return undefined;
}

function getProjectItemId(
  projectItems: ProjectItemNode[],
  projectNumber: number,
): string | null {
  const projectItem = projectItems.find(
    (item) => item.project?.number === projectNumber,
  );
  return projectItem?.id || null;
}

function parseProjectState(
  projectItems: ProjectItemNode[],
  projectNumber: number,
): ProjectState {
  const projectItem = projectItems.find(
    (item) => item.project?.number === projectNumber,
  );

  if (!projectItem) {
    return { status: null, iteration: 0, failures: 0 };
  }

  let status: ProjectStatus | null = null;
  let iteration = 0;
  let failures = 0;

  const fieldValues = projectItem.fieldValues?.nodes || [];
  for (const fieldValue of fieldValues) {
    const fieldName = fieldValue.field?.name;
    if (fieldName === "Status" && fieldValue.name) {
      status = fieldValue.name as ProjectStatus;
    } else if (
      fieldName === "Iteration" &&
      typeof fieldValue.number === "number"
    ) {
      iteration = fieldValue.number;
    } else if (
      fieldName === "Failures" &&
      typeof fieldValue.number === "number"
    ) {
      failures = fieldValue.number;
    }
  }

  return { status, iteration, failures };
}

async function getOrAddProjectItem(
  octokit: Octokit,
  ctx: RunnerContext,
  issueNumber: number,
): Promise<{
  itemId: string;
  projectFields: ProjectFields;
  currentState: ProjectState;
}> {
  const response = await octokit.graphql<QueryResponse>(
    GET_PROJECT_ITEM_QUERY,
    {
      org: ctx.owner,
      repo: ctx.repo,
      issueNumber,
      projectNumber: ctx.projectNumber,
    },
  );

  const issue = response.repository?.issue;
  const projectData = response.organization;

  if (!issue || !projectData?.projectV2) {
    throw new Error(`Issue #${issueNumber} or project not found`);
  }

  const projectFields = parseProjectFields(projectData);
  if (!projectFields) {
    throw new Error("Failed to parse project fields");
  }

  const projectItems = issue.projectItems?.nodes || [];
  let itemId = getProjectItemId(projectItems, ctx.projectNumber);
  const currentState = parseProjectState(projectItems, ctx.projectNumber);

  // Add issue to project if not already
  if (!itemId) {
    core.info(`Adding issue #${issueNumber} to project ${ctx.projectNumber}`);

    interface AddItemResponse {
      addProjectV2ItemById?: {
        item?: { id?: string };
      };
    }

    const addResult = await octokit.graphql<AddItemResponse>(
      ADD_ISSUE_TO_PROJECT_MUTATION,
      {
        projectId: projectFields.projectId,
        contentId: issue.id,
      },
    );

    itemId = addResult.addProjectV2ItemById?.item?.id || null;
    if (!itemId) {
      throw new Error("Failed to add issue to project");
    }
  }

  return { itemId, projectFields, currentState };
}

// ============================================================================
// Executor Functions
// ============================================================================

/**
 * Update the project Status field
 */
export async function executeUpdateProjectStatus(
  action: UpdateProjectStatusAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean; previousStatus: ProjectStatus | null }> {
  const { itemId, projectFields, currentState } = await getOrAddProjectItem(
    ctx.octokit,
    ctx,
    action.issueNumber,
  );

  const optionId = findStatusOption(projectFields.statusOptions, action.status);
  if (!optionId) {
    core.warning(`Status option '${action.status}' not found in project`);
    return { updated: false, previousStatus: currentState.status };
  }

  await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
    projectId: projectFields.projectId,
    itemId,
    fieldId: projectFields.statusFieldId,
    value: { singleSelectOptionId: optionId },
  });

  core.info(
    `Updated Status to ${action.status} for issue #${action.issueNumber}`,
  );
  return { updated: true, previousStatus: currentState.status };
}

/**
 * Increment the Iteration counter
 */
export async function executeIncrementIteration(
  action: IncrementIterationAction,
  ctx: RunnerContext,
): Promise<{ newIteration: number }> {
  const { itemId, projectFields, currentState } = await getOrAddProjectItem(
    ctx.octokit,
    ctx,
    action.issueNumber,
  );

  const newIteration = currentState.iteration + 1;

  await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
    projectId: projectFields.projectId,
    itemId,
    fieldId: projectFields.iterationFieldId,
    value: { number: newIteration },
  });

  core.info(
    `Incremented Iteration to ${newIteration} for issue #${action.issueNumber}`,
  );
  return { newIteration };
}

/**
 * Record a failure (increment Failures counter)
 */
export async function executeRecordFailure(
  action: RecordFailureAction,
  ctx: RunnerContext,
): Promise<{ newFailures: number }> {
  const { itemId, projectFields, currentState } = await getOrAddProjectItem(
    ctx.octokit,
    ctx,
    action.issueNumber,
  );

  const newFailures = currentState.failures + 1;

  await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
    projectId: projectFields.projectId,
    itemId,
    fieldId: projectFields.failuresFieldId,
    value: { number: newFailures },
  });

  core.info(
    `Incremented Failures to ${newFailures} for issue #${action.issueNumber}`,
  );
  return { newFailures };
}

/**
 * Clear failures (reset to 0)
 */
export async function executeClearFailures(
  action: ClearFailuresAction,
  ctx: RunnerContext,
): Promise<{ previousFailures: number }> {
  const { itemId, projectFields, currentState } = await getOrAddProjectItem(
    ctx.octokit,
    ctx,
    action.issueNumber,
  );

  await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
    projectId: projectFields.projectId,
    itemId,
    fieldId: projectFields.failuresFieldId,
    value: { number: 0 },
  });

  core.info(`Cleared Failures for issue #${action.issueNumber}`);
  return { previousFailures: currentState.failures };
}

/**
 * Block an issue (set Blocked status)
 */
export async function executeBlock(
  action: BlockAction,
  ctx: RunnerContext,
): Promise<{ blocked: boolean }> {
  const { itemId, projectFields } = await getOrAddProjectItem(
    ctx.octokit,
    ctx,
    action.issueNumber,
  );

  const optionId = findStatusOption(projectFields.statusOptions, "Blocked");
  if (!optionId) {
    core.warning("Blocked status option not found in project");
    return { blocked: false };
  }

  await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
    projectId: projectFields.projectId,
    itemId,
    fieldId: projectFields.statusFieldId,
    value: { singleSelectOptionId: optionId },
  });

  core.info(`Blocked issue #${action.issueNumber}: ${action.reason}`);
  return { blocked: true };
}
