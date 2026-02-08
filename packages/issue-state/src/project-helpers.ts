/**
 * Project field update helpers.
 * Shared logic for updating GitHub project fields (Status, Iteration, Failures).
 */

import type { OctokitLike } from "./client.js";
import type { ProjectStatus } from "./schemas/index.js";
import {
  GET_PROJECT_ITEM_QUERY,
  UPDATE_PROJECT_FIELD_MUTATION,
  ADD_ISSUE_TO_PROJECT_MUTATION,
} from "./graphql/project-queries.js";

// ============================================================================
// Types
// ============================================================================

export interface ProjectFieldInfo {
  projectId: string;
  projectItemId: string | null;
  statusFieldId: string | null;
  statusOptions: Map<string, string>; // name -> optionId
  iterationFieldId: string | null;
  failuresFieldId: string | null;
}

interface ProjectItemResponse {
  repository: {
    issue: {
      id: string;
      projectItems: {
        nodes: Array<{
          id: string;
          project: {
            id: string;
            number: number;
          };
        }>;
      };
    } | null;
  } | null;
  organization: {
    projectV2: {
      id: string;
      fields: {
        nodes: Array<{
          id: string;
          name: string;
          dataType?: string;
          options?: Array<{
            id: string;
            name: string;
          }>;
        }>;
      };
    } | null;
  } | null;
}

interface AddToProjectResponse {
  addProjectV2ItemById: {
    item: {
      id: string;
    };
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get project field info for an issue, including the project item ID if the issue
 * is already in the project.
 */
export async function getProjectFieldInfo(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<ProjectFieldInfo | null> {
  try {
    const response = await octokit.graphql<ProjectItemResponse>(
      GET_PROJECT_ITEM_QUERY,
      {
        org: owner,
        repo,
        issueNumber,
        projectNumber,
      },
    );

    const project = response.organization?.projectV2;
    if (!project) {
      return null;
    }

    // Find project item ID for this issue in this project
    let projectItemId: string | null = null;
    const projectItems = response.repository?.issue?.projectItems?.nodes || [];
    for (const item of projectItems) {
      if (item.project?.number === projectNumber) {
        projectItemId = item.id;
        break;
      }
    }

    let statusFieldId: string | null = null;
    const statusOptions = new Map<string, string>();
    let iterationFieldId: string | null = null;
    let failuresFieldId: string | null = null;

    for (const field of project.fields.nodes) {
      if (field.name === "Status" && field.options) {
        statusFieldId = field.id;
        for (const option of field.options) {
          statusOptions.set(option.name, option.id);
        }
      } else if (field.name === "Iteration" && field.dataType === "NUMBER") {
        iterationFieldId = field.id;
      } else if (field.name === "Failures" && field.dataType === "NUMBER") {
        failuresFieldId = field.id;
      }
    }

    return {
      projectId: project.id,
      projectItemId,
      statusFieldId,
      statusOptions,
      iterationFieldId,
      failuresFieldId,
    };
  } catch {
    return null;
  }
}

/**
 * Add an issue to a project if it's not already there.
 */
export async function addIssueToProject(
  octokit: OctokitLike,
  projectId: string,
  issueId: string,
): Promise<string> {
  const response = await octokit.graphql<AddToProjectResponse>(
    ADD_ISSUE_TO_PROJECT_MUTATION,
    {
      projectId,
      contentId: issueId,
    },
  );

  return response.addProjectV2ItemById.item.id;
}

/**
 * Update a single project field value.
 */
export async function updateProjectField(
  octokit: OctokitLike,
  projectId: string,
  itemId: string,
  fieldId: string,
  value: { singleSelectOptionId: string } | { number: number },
): Promise<void> {
  await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
    projectId,
    itemId,
    fieldId,
    value,
  });
}

/**
 * Update project fields (Status, Iteration, Failures) for an issue.
 * If the issue is not in the project, it will be added first.
 */
export async function updateProjectFields(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
  fields: {
    status?: ProjectStatus | null;
    iteration?: number;
    failures?: number;
  },
): Promise<void> {
  const fieldInfo = await getProjectFieldInfo(
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
  );

  if (!fieldInfo) {
    // Project doesn't exist or we can't access it
    return;
  }

  let projectItemId = fieldInfo.projectItemId;

  // If issue is not in project, we can't update fields
  // (addIssueToProject requires the issue's GraphQL ID which we don't have here)
  if (!projectItemId) {
    return;
  }

  const fieldUpdates: Promise<void>[] = [];

  // Update Status field
  if (fields.status !== undefined && fieldInfo.statusFieldId) {
    const optionId = fields.status
      ? fieldInfo.statusOptions.get(fields.status)
      : null;
    if (optionId) {
      fieldUpdates.push(
        updateProjectField(
          octokit,
          fieldInfo.projectId,
          projectItemId,
          fieldInfo.statusFieldId,
          { singleSelectOptionId: optionId },
        ),
      );
    }
  }

  // Update Iteration field
  if (fields.iteration !== undefined && fieldInfo.iterationFieldId) {
    fieldUpdates.push(
      updateProjectField(
        octokit,
        fieldInfo.projectId,
        projectItemId,
        fieldInfo.iterationFieldId,
        { number: fields.iteration },
      ),
    );
  }

  // Update Failures field
  if (fields.failures !== undefined && fieldInfo.failuresFieldId) {
    fieldUpdates.push(
      updateProjectField(
        octokit,
        fieldInfo.projectId,
        projectItemId,
        fieldInfo.failuresFieldId,
        { number: fields.failures },
      ),
    );
  }

  await Promise.all(fieldUpdates);
}
