/**
 * Project Field Executors
 *
 * Executors for updating GitHub Project fields (Status, Iteration, Failures).
 */

import * as core from "@actions/core";
import {
  GET_PROJECT_ITEM_QUERY,
  UPDATE_PROJECT_FIELD_MUTATION,
  CLEAR_PROJECT_FIELD_MUTATION,
  ADD_ISSUE_TO_PROJECT_MUTATION,
  DELETE_PROJECT_ITEM_MUTATION,
} from "@more/issue-state";
import type {
  UpdateProjectStatusAction,
  IncrementIterationAction,
  RecordFailureAction,
  ClearFailuresAction,
  RemoveFromProjectAction,
  BlockAction,
  ProjectStatus,
} from "../../schemas/index.js";
import type { RunnerContext, Octokit } from "../types.js";

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
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GraphQL response typed as unknown, casting to known response shape
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
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub project field value matches ProjectStatus union
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

/**
 * Reopen a closed issue via REST API.
 * Called automatically when setting a non-terminal project status so that
 * recovery flows (e.g., /retry) don't leave issues closed.
 */
async function ensureIssueOpen(
  ctx: RunnerContext,
  issueNumber: number,
): Promise<void> {
  try {
    const { data: issue } = await ctx.octokit.rest.issues.get({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
    });

    if (issue.state === "closed") {
      await ctx.octokit.rest.issues.update({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: issueNumber,
        state: "open",
      });
      core.info(`Reopened closed issue #${issueNumber}`);
    }
  } catch (error) {
    core.warning(`Failed to ensure issue #${issueNumber} is open: ${error}`);
  }
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

  // null status means clear the field
  if (action.status === null) {
    await ctx.octokit.graphql(CLEAR_PROJECT_FIELD_MUTATION, {
      projectId: projectFields.projectId,
      itemId,
      fieldId: projectFields.statusFieldId,
    });

    core.info(`Cleared Status for issue #${action.issueNumber}`);
    return { updated: true, previousStatus: currentState.status };
  }

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

  // Reopen the issue if it's closed and we're setting a non-terminal status.
  // This handles recovery scenarios (e.g., /retry on a blocked issue whose
  // PR was merged with failing CI, causing the issue to be closed).
  if (action.status !== "Done") {
    await ensureIssueOpen(ctx, action.issueNumber);
  }

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

/**
 * Remove an issue from the project board.
 * No-op if the issue is not on the project.
 */
export async function executeRemoveFromProject(
  action: RemoveFromProjectAction,
  ctx: RunnerContext,
): Promise<{ removed: boolean }> {
  const response = await ctx.octokit.graphql<QueryResponse>(
    GET_PROJECT_ITEM_QUERY,
    {
      org: ctx.owner,
      repo: ctx.repo,
      issueNumber: action.issueNumber,
      projectNumber: ctx.projectNumber,
    },
  );

  const issue = response.repository?.issue;
  const projectData = response.organization;

  if (!issue || !projectData?.projectV2) {
    core.warning(
      `Issue #${action.issueNumber} or project not found — skipping remove`,
    );
    return { removed: false };
  }

  const projectItems = issue.projectItems?.nodes || [];
  const itemId = getProjectItemId(projectItems, ctx.projectNumber);

  if (!itemId) {
    core.info(
      `Issue #${action.issueNumber} not on project — nothing to remove`,
    );
    return { removed: false };
  }

  const projectFields = parseProjectFields(projectData);
  if (!projectFields) {
    core.warning("Failed to parse project fields — skipping remove");
    return { removed: false };
  }

  await ctx.octokit.graphql(DELETE_PROJECT_ITEM_MUTATION, {
    projectId: projectFields.projectId,
    itemId,
  });

  core.info(`Removed issue #${action.issueNumber} from project`);
  return { removed: true };
}
