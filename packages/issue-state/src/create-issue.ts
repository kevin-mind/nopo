/**
 * createIssue() — create a GitHub issue with project fields, sub-issues, and comments.
 */

import type { OctokitLike } from "./client.js";
import type { ProjectStatus } from "./schemas/index.js";
import {
  CREATE_ISSUE_MUTATION,
  ADD_SUB_ISSUE_MUTATION,
  GET_REPO_ID_QUERY,
} from "./graphql/issue-mutations.js";
import {
  ADD_ISSUE_TO_PROJECT_MUTATION,
  UPDATE_PROJECT_FIELD_MUTATION,
} from "./graphql/project-queries.js";

// ============================================================================
// Types
// ============================================================================

export interface CreateIssueInput {
  title: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
  /** Sub-issues to create and link to parent */
  subIssues?: Array<{
    title: string;
    body?: string;
    assignees?: string[];
    labels?: string[];
  }>;
  /** Comments to add after creation */
  comments?: Array<{
    body: string;
  }>;
}

export interface CreateIssueProjectFields {
  status?: ProjectStatus;
  iteration?: number;
  failures?: number;
}

export interface CreateIssueOptions {
  octokit: OctokitLike;
  /** Project number to add issue to (required for project fields) */
  projectNumber?: number;
  /** Organization name (defaults to owner if not specified) */
  organization?: string;
  /** Project field values */
  projectFields?: CreateIssueProjectFields;
}

export interface CreateIssueResult {
  issueNumber: number;
  issueId: string;
  subIssueNumbers: number[];
}

// ============================================================================
// GraphQL Types
// ============================================================================

interface RepoIdResponse {
  repository: {
    id: string;
  } | null;
}

interface CreateIssueResponse {
  createIssue: {
    issue: {
      id: string;
      number: number;
    };
  };
}

interface AddToProjectResponse {
  addProjectV2ItemById: {
    item: {
      id: string;
    };
  };
}

interface ProjectFieldsResponse {
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

// Query to get project fields (Status options, Iteration/Failures field IDs)
const GET_PROJECT_FIELDS_QUERY = `
query GetProjectFields($org: String!, $projectNumber: Int!) {
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

// ============================================================================
// Helpers
// ============================================================================

async function getRepoId(
  octokit: OctokitLike,
  owner: string,
  repo: string,
): Promise<string> {
  const response = await octokit.graphql<RepoIdResponse>(GET_REPO_ID_QUERY, {
    owner,
    repo,
  });

  if (!response.repository?.id) {
    throw new Error(`Repository ${owner}/${repo} not found`);
  }

  return response.repository.id;
}

async function createIssueInRepo(
  octokit: OctokitLike,
  repositoryId: string,
  title: string,
  body: string,
): Promise<{ id: string; number: number }> {
  const response = await octokit.graphql<CreateIssueResponse>(
    CREATE_ISSUE_MUTATION,
    {
      repositoryId,
      title,
      body,
    },
  );

  return {
    id: response.createIssue.issue.id,
    number: response.createIssue.issue.number,
  };
}

async function linkSubIssue(
  octokit: OctokitLike,
  parentId: string,
  childId: string,
): Promise<void> {
  await octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
    parentId,
    childId,
  });
}

async function addIssueToProject(
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

interface ProjectFieldInfo {
  projectId: string;
  statusFieldId: string | null;
  statusOptions: Map<string, string>; // name -> optionId
  iterationFieldId: string | null;
  failuresFieldId: string | null;
}

async function getProjectFieldInfo(
  octokit: OctokitLike,
  organization: string,
  projectNumber: number,
): Promise<ProjectFieldInfo | null> {
  try {
    const response = await octokit.graphql<ProjectFieldsResponse>(
      GET_PROJECT_FIELDS_QUERY,
      {
        org: organization,
        projectNumber,
      },
    );

    const project = response.organization?.projectV2;
    if (!project) {
      return null;
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
      statusFieldId,
      statusOptions,
      iterationFieldId,
      failuresFieldId,
    };
  } catch {
    return null;
  }
}

async function updateProjectField(
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

// ============================================================================
// Main
// ============================================================================

/**
 * Create a GitHub issue with optional project fields, sub-issues, and comments.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param input - Issue creation input (title, body, labels, etc.)
 * @param options - Creation options (octokit, project settings)
 * @returns Created issue number and sub-issue numbers
 *
 * @example
 * ```typescript
 * const result = await createIssue("owner", "repo", {
 *   title: "My Issue",
 *   body: "Description",
 *   labels: ["bug"],
 *   assignees: ["user1"],
 *   subIssues: [
 *     { title: "[Phase 1]: Setup", body: "Phase 1 description" },
 *     { title: "[Phase 2]: Implementation", body: "Phase 2 description" },
 *   ],
 *   comments: [
 *     { body: "Initial comment" }
 *   ]
 * }, {
 *   octokit,
 *   projectNumber: 1,
 *   projectFields: { status: "In progress", iteration: 0, failures: 0 }
 * });
 * ```
 */
export async function createIssue(
  owner: string,
  repo: string,
  input: CreateIssueInput,
  options: CreateIssueOptions,
): Promise<CreateIssueResult> {
  const {
    octokit,
    projectNumber,
    organization = owner,
    projectFields,
  } = options;

  // Get repository ID for creating issues
  const repositoryId = await getRepoId(octokit, owner, repo);

  // Create the parent issue
  const parentIssue = await createIssueInRepo(
    octokit,
    repositoryId,
    input.title,
    input.body || "",
  );

  // Track sub-issue numbers
  const subIssueNumbers: number[] = [];

  // Create sub-issues and link them to parent
  if (input.subIssues && input.subIssues.length > 0) {
    for (const subIssueInput of input.subIssues) {
      const subIssue = await createIssueInRepo(
        octokit,
        repositoryId,
        subIssueInput.title,
        subIssueInput.body || "",
      );

      // Link sub-issue to parent
      await linkSubIssue(octokit, parentIssue.id, subIssue.id);
      subIssueNumbers.push(subIssue.number);

      // Add labels to sub-issue
      if (subIssueInput.labels && subIssueInput.labels.length > 0) {
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: subIssue.number,
          labels: subIssueInput.labels,
        });
      }

      // Add assignees to sub-issue
      if (subIssueInput.assignees && subIssueInput.assignees.length > 0) {
        await octokit.rest.issues.addAssignees({
          owner,
          repo,
          issue_number: subIssue.number,
          assignees: subIssueInput.assignees,
        });
      }

      // Add sub-issue to project if project number is specified
      if (projectNumber) {
        const fieldInfo = await getProjectFieldInfo(
          octokit,
          organization,
          projectNumber,
        );
        if (fieldInfo) {
          await addIssueToProject(octokit, fieldInfo.projectId, subIssue.id);
        }
      }
    }
  }

  // Add labels to parent issue
  if (input.labels && input.labels.length > 0) {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: parentIssue.number,
      labels: input.labels,
    });
  }

  // Add assignees to parent issue
  if (input.assignees && input.assignees.length > 0) {
    await octokit.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: parentIssue.number,
      assignees: input.assignees,
    });
  }

  // Add to project and update project fields
  if (projectNumber) {
    const fieldInfo = await getProjectFieldInfo(
      octokit,
      organization,
      projectNumber,
    );

    if (fieldInfo) {
      // Add issue to project
      const projectItemId = await addIssueToProject(
        octokit,
        fieldInfo.projectId,
        parentIssue.id,
      );

      // Update project fields
      if (projectFields) {
        const fieldUpdates: Promise<void>[] = [];

        // Update Status field
        if (projectFields.status && fieldInfo.statusFieldId) {
          const optionId = fieldInfo.statusOptions.get(projectFields.status);
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
        if (
          projectFields.iteration !== undefined &&
          fieldInfo.iterationFieldId
        ) {
          fieldUpdates.push(
            updateProjectField(
              octokit,
              fieldInfo.projectId,
              projectItemId,
              fieldInfo.iterationFieldId,
              { number: projectFields.iteration },
            ),
          );
        }

        // Update Failures field
        if (projectFields.failures !== undefined && fieldInfo.failuresFieldId) {
          fieldUpdates.push(
            updateProjectField(
              octokit,
              fieldInfo.projectId,
              projectItemId,
              fieldInfo.failuresFieldId,
              { number: projectFields.failures },
            ),
          );
        }

        await Promise.all(fieldUpdates);
      }
    }
  }

  // Add comments
  if (input.comments && input.comments.length > 0) {
    for (const comment of input.comments) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: parentIssue.number,
        body: comment.body,
      });
    }
  }

  return {
    issueNumber: parentIssue.number,
    issueId: parentIssue.id,
    subIssueNumbers,
  };
}
