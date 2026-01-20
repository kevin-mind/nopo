import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../lib/index.js";
import type {
  TestFixture,
  FixtureCreationResult,
  VerificationResult,
  VerificationError,
} from "./types.js";

// GraphQL queries
const GET_PROJECT_ITEM_QUERY = `
query GetProjectItem($org: String!, $projectNumber: Int!, $issueNumber: Int!, $repo: String!) {
  repository(owner: $org, name: $repo) {
    issue(number: $issueNumber) {
      id
      number
      title
      body
      state
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
                    options {
                      id
                      name
                    }
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

const GET_SUB_ISSUES_QUERY = `
query GetSubIssues($org: String!, $repo: String!, $parentNumber: Int!) {
  repository(owner: $org, name: $repo) {
    issue(number: $parentNumber) {
      id
      subIssues(first: 20) {
        nodes {
          id
          number
          title
          state
          projectItems(first: 10) {
            nodes {
              project {
                number
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
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

const ADD_SUB_ISSUE_MUTATION = `
mutation AddSubIssue($parentId: ID!, $subIssueId: ID!) {
  addSubIssue(input: {
    issueId: $parentId
    subIssueId: $subIssueId
  }) {
    issue {
      id
    }
    subIssue {
      id
    }
  }
}
`;

const GET_DISCUSSION_CATEGORIES_QUERY = `
query GetDiscussionCategories($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
    discussionCategories(first: 20) {
      nodes {
        id
        name
        slug
      }
    }
  }
}
`;

const CREATE_DISCUSSION_MUTATION = `
mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: {
    repositoryId: $repositoryId
    categoryId: $categoryId
    title: $title
    body: $body
  }) {
    discussion {
      id
      number
      url
    }
  }
}
`;

const ADD_DISCUSSION_COMMENT_MUTATION = `
mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    body: $body
  }) {
    comment {
      id
    }
  }
}
`;

const _GET_DISCUSSION_QUERY = `
query GetDiscussion($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
      comments(first: 100) {
        totalCount
        nodes {
          id
          body
          author {
            login
          }
        }
      }
    }
  }
}
`;

const _CLOSE_DISCUSSION_MUTATION = `
mutation CloseDiscussion($discussionId: ID!) {
  closeDiscussion(input: {
    discussionId: $discussionId
  }) {
    discussion {
      id
    }
  }
}
`;

interface ProjectFields {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  iterationFieldId: string;
  failuresFieldId: string;
}

function parseProjectFields(projectData: unknown): ProjectFields | null {
  interface Field {
    id?: string;
    name?: string;
    options?: Array<{ id: string; name: string }>;
    dataType?: string;
  }

  interface Project {
    id?: string;
    fields?: { nodes?: Field[] };
  }

  const project = projectData as Project;
  if (!project?.id || !project?.fields?.nodes) {
    return null;
  }

  const fields: ProjectFields = {
    projectId: project.id,
    statusFieldId: "",
    statusOptions: {},
    iterationFieldId: "",
    failuresFieldId: "",
  };

  for (const field of project.fields.nodes) {
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

/**
 * Create a test fixture from JSON configuration
 */
async function createFixture(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  fixture: TestFixture,
  projectNumber: number,
  stepwiseMode: boolean = false,
): Promise<FixtureCreationResult> {
  const result: FixtureCreationResult = {
    issue_number: 0,
    sub_issue_numbers: [],
  };

  // For discussion-only fixtures (no parent_issue), skip issue creation
  if (!fixture.parent_issue) {
    core.info("No parent_issue in fixture - creating discussion-only fixture");

    // Create discussion if specified
    if (fixture.discussion) {
      core.info(`Creating discussion: ${fixture.discussion.title}`);

      interface CategoriesResponse {
        repository?: {
          id?: string;
          discussionCategories?: {
            nodes?: Array<{
              id: string;
              name: string;
              slug: string;
            }>;
          };
        };
      }

      const categoriesResponse = await octokit.graphql<CategoriesResponse>(
        GET_DISCUSSION_CATEGORIES_QUERY,
        { owner, repo },
      );

      const repoId = categoriesResponse.repository?.id;
      const categories =
        categoriesResponse.repository?.discussionCategories?.nodes || [];
      const targetCategory = fixture.discussion.category || "general";
      const category = categories.find(
        (c) =>
          c.slug === targetCategory ||
          c.name.toLowerCase() === targetCategory.toLowerCase(),
      );

      if (!repoId || !category) {
        core.warning(
          `Could not find category "${targetCategory}" for discussion. Available: ${categories.map((c) => c.slug).join(", ")}`,
        );
      } else {
        interface CreateDiscussionResponse {
          createDiscussion?: {
            discussion?: {
              id: string;
              number: number;
              url: string;
            };
          };
        }

        const discussionResponse =
          await octokit.graphql<CreateDiscussionResponse>(
            CREATE_DISCUSSION_MUTATION,
            {
              repositoryId: repoId,
              categoryId: category.id,
              title: `[TEST] ${fixture.discussion.title}`,
              body: fixture.discussion.body,
            },
          );

        const discussion = discussionResponse.createDiscussion?.discussion;
        if (discussion) {
          result.discussion_number = discussion.number;
          core.info(
            `Created discussion #${discussion.number}: ${discussion.url}`,
          );

          // Add comment to discussion if specified
          if (fixture.comment) {
            await octokit.graphql(ADD_DISCUSSION_COMMENT_MUTATION, {
              discussionId: discussion.id,
              body: fixture.comment.body,
            });
            core.info("Added comment to discussion");
          }
        }
      }
    }

    return result;
  }

  // Create parent issue with [TEST] prefix and test:automation label
  const parentTitle = `[TEST] ${fixture.parent_issue.title}`;
  const parentLabels = [
    "test:automation",
    ...(stepwiseMode ? ["_test"] : []),
    ...(fixture.parent_issue.labels || []),
  ];

  core.info(`Creating parent issue: ${parentTitle}`);

  const { data: parentIssue } = await octokit.rest.issues.create({
    owner,
    repo,
    title: parentTitle,
    body: fixture.parent_issue.body,
    labels: parentLabels,
  });

  result.issue_number = parentIssue.number;
  const issueNodeId = parentIssue.node_id; // Use node_id from REST API directly
  core.info(`Created parent issue #${parentIssue.number}`);
  core.info(`Issue node_id: ${issueNodeId}`);

  // Get project fields for setting project values
  interface ProjectQueryResponse {
    organization?: {
      projectV2?: unknown;
    };
  }

  // Try to set project fields, but gracefully handle missing project access
  let projectFields: ProjectFields | null = null;

  try {
    const projectResponse = await octokit.graphql<ProjectQueryResponse>(
      `query GetProjectFields($org: String!, $projectNumber: Int!) {
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
      }`,
      {
        org: owner,
        projectNumber,
      },
    );

    const projectData = projectResponse.organization?.projectV2;
    core.info(`Project query result - org: ${owner}, projectNumber: ${projectNumber}`);
    core.info(`Project data: ${JSON.stringify(projectData)}`);
    projectFields = parseProjectFields(projectData);
    if (projectFields) {
      core.info(`Parsed project fields - projectId: ${projectFields.projectId}`);
    }
  } catch (error) {
    core.warning(
      `Could not access project #${projectNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
    core.warning("Continuing without project field setup");
  }

  if (projectFields && fixture.parent_issue.project_fields) {
    try {
      // Add issue to project
      interface AddItemResponse {
        addProjectV2ItemById?: {
          item?: { id?: string };
        };
      }

      const addResult = await octokit.graphql<AddItemResponse>(
        ADD_ISSUE_TO_PROJECT_MUTATION,
        {
          projectId: projectFields.projectId,
          contentId: issueNodeId,
        },
      );

      const itemId = addResult.addProjectV2ItemById?.item?.id;
      if (itemId) {
        // Set status if specified
        const statusValue = fixture.parent_issue.project_fields.Status;
        if (statusValue) {
          const optionId = projectFields.statusOptions[statusValue];
          if (optionId) {
            await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
              projectId: projectFields.projectId,
              itemId,
              fieldId: projectFields.statusFieldId,
              value: { singleSelectOptionId: optionId },
            });
            core.info(`Set parent Status to ${statusValue}`);
          }
        }

        // Set iteration if specified
        if (fixture.parent_issue.project_fields.Iteration !== undefined) {
          await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
            projectId: projectFields.projectId,
            itemId,
            fieldId: projectFields.iterationFieldId,
            value: { number: fixture.parent_issue.project_fields.Iteration },
          });
          core.info(
            `Set parent Iteration to ${fixture.parent_issue.project_fields.Iteration}`,
          );
        }

        // Set failures if specified
        if (fixture.parent_issue.project_fields.Failures !== undefined) {
          await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
            projectId: projectFields.projectId,
            itemId,
            fieldId: projectFields.failuresFieldId,
            value: { number: fixture.parent_issue.project_fields.Failures },
          });
          core.info(
            `Set parent Failures to ${fixture.parent_issue.project_fields.Failures}`,
          );
        }
      }
    } catch (error) {
      core.warning(
        `Failed to set project fields for parent issue: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Create sub-issues if specified
  if (fixture.sub_issues && fixture.sub_issues.length > 0) {
    for (let i = 0; i < fixture.sub_issues.length; i++) {
      const subConfig = fixture.sub_issues[i];
      if (!subConfig) continue;

      const subTitle = `[Phase ${i + 1}] ${subConfig.title} (parent #${parentIssue.number})`;

      core.info(`Creating sub-issue: ${subTitle}`);

      const { data: subIssue } = await octokit.rest.issues.create({
        owner,
        repo,
        title: subTitle,
        body: subConfig.body,
        labels: ["test:automation", ...(stepwiseMode ? ["_test"] : [])],
      });

      result.sub_issue_numbers.push(subIssue.number);
      core.info(`Created sub-issue #${subIssue.number}`);

      // Link sub-issue to parent using GraphQL
      // First get the node IDs
      const { data: parentData } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: parentIssue.number,
      });

      const { data: subData } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: subIssue.number,
      });

      try {
        await octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
          parentId: parentData.node_id,
          subIssueId: subData.node_id,
        });
        core.info(
          `Linked sub-issue #${subIssue.number} to parent #${parentIssue.number}`,
        );
      } catch (error) {
        core.warning(`Failed to link sub-issue: ${error}`);
      }

      // Set sub-issue project fields if specified
      if (subConfig.project_fields && projectFields) {
        // Add sub-issue to project
        interface AddItemResponse {
          addProjectV2ItemById?: {
            item?: { id?: string };
          };
        }

        const addResult = await octokit.graphql<AddItemResponse>(
          ADD_ISSUE_TO_PROJECT_MUTATION,
          {
            projectId: projectFields.projectId,
            contentId: subData.node_id,
          },
        );

        const subItemId = addResult.addProjectV2ItemById?.item?.id;
        if (subItemId && subConfig.project_fields.Status) {
          const optionId =
            projectFields.statusOptions[subConfig.project_fields.Status];
          if (optionId) {
            await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
              projectId: projectFields.projectId,
              itemId: subItemId,
              fieldId: projectFields.statusFieldId,
              value: { singleSelectOptionId: optionId },
            });
            core.info(
              `Set sub-issue #${subIssue.number} Status to ${subConfig.project_fields.Status}`,
            );
          }
        }
      }
    }
  }

  // Create branch if specified
  if (fixture.branch) {
    const branchName = `test/${fixture.branch.name}`;
    result.branch_name = branchName;

    core.info(`Creating branch: ${branchName}`);

    // Get the SHA of the base branch
    const { data: baseBranch } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: fixture.branch.from,
    });

    // Create the new branch
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseBranch.commit.sha,
    });

    core.info(`Created branch ${branchName} from ${fixture.branch.from}`);

    // Add commits if specified
    if (fixture.branch.commits && fixture.branch.commits.length > 0) {
      for (const commit of fixture.branch.commits) {
        // Get current tree
        const { data: currentRef } = await octokit.rest.git.getRef({
          owner,
          repo,
          ref: `heads/${branchName}`,
        });

        const { data: currentCommit } = await octokit.rest.git.getCommit({
          owner,
          repo,
          commit_sha: currentRef.object.sha,
        });

        // Create blobs for each file
        const treeItems: Array<{
          path: string;
          mode: "100644";
          type: "blob";
          sha: string;
        }> = [];

        for (const [path, content] of Object.entries(commit.files)) {
          const { data: blob } = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: Buffer.from(content).toString("base64"),
            encoding: "base64",
          });

          treeItems.push({
            path,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          });
        }

        // Create tree
        const { data: newTree } = await octokit.rest.git.createTree({
          owner,
          repo,
          base_tree: currentCommit.tree.sha,
          tree: treeItems,
        });

        // Create commit
        const { data: newCommit } = await octokit.rest.git.createCommit({
          owner,
          repo,
          message: commit.message,
          tree: newTree.sha,
          parents: [currentRef.object.sha],
        });

        // Update branch ref
        await octokit.rest.git.updateRef({
          owner,
          repo,
          ref: `heads/${branchName}`,
          sha: newCommit.sha,
        });

        core.info(`Added commit: ${commit.message}`);
      }
    }
  }

  // Create PR if specified
  if (fixture.pr && result.branch_name) {
    core.info(`Creating PR: ${fixture.pr.title}`);

    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `[TEST] ${fixture.pr.title}`,
      body: fixture.pr.body.replace(
        "{ISSUE_NUMBER}",
        String(result.issue_number),
      ),
      head: result.branch_name,
      base: "main",
      draft: fixture.pr.draft ?? true, // Default to draft
    });

    result.pr_number = pr.number;
    core.info(`Created PR #${pr.number}`);

    // Add test:automation label (and _test for stepwise mode) to PR
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pr.number,
      labels: ["test:automation", ...(stepwiseMode ? ["_test"] : [])],
    });

    // Request review if specified
    if (fixture.pr.request_review) {
      try {
        await octokit.rest.pulls.requestReviewers({
          owner,
          repo,
          pull_number: pr.number,
          reviewers: ["nopo-bot"],
        });
        core.info("Requested nopo-bot as reviewer");
      } catch (error) {
        core.warning(`Failed to request reviewer: ${error}`);
      }
    }
  }

  // Create comment on issue if specified
  if (fixture.comment && result.issue_number) {
    core.info("Adding comment to issue");
    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: result.issue_number,
      body: fixture.comment.body,
    });
    result.comment_id = String(comment.id);
    core.info(`Created comment ${comment.id}`);
  }

  // Create review on PR if specified
  if (fixture.review && result.pr_number) {
    core.info(`Submitting review with state: ${fixture.review.state}`);

    const eventMap: Record<string, "APPROVE" | "REQUEST_CHANGES" | "COMMENT"> =
      {
        approve: "APPROVE",
        request_changes: "REQUEST_CHANGES",
        comment: "COMMENT",
      };

    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: result.pr_number,
      body: fixture.review.body,
      event: eventMap[fixture.review.state],
    });
    core.info("Review submitted");
  }

  // Create discussion if specified
  if (fixture.discussion) {
    core.info(`Creating discussion: ${fixture.discussion.title}`);

    interface CategoriesResponse {
      repository?: {
        id?: string;
        discussionCategories?: {
          nodes?: Array<{
            id: string;
            name: string;
            slug: string;
          }>;
        };
      };
    }

    const categoriesResponse = await octokit.graphql<CategoriesResponse>(
      GET_DISCUSSION_CATEGORIES_QUERY,
      { owner, repo },
    );

    const repoId = categoriesResponse.repository?.id;
    const categories =
      categoriesResponse.repository?.discussionCategories?.nodes || [];
    const targetCategory = fixture.discussion.category || "general";
    const category = categories.find(
      (c) =>
        c.slug === targetCategory ||
        c.name.toLowerCase() === targetCategory.toLowerCase(),
    );

    if (!repoId || !category) {
      core.warning(
        `Could not find category "${targetCategory}" for discussion. Available: ${categories.map((c) => c.slug).join(", ")}`,
      );
    } else {
      interface CreateDiscussionResponse {
        createDiscussion?: {
          discussion?: {
            id: string;
            number: number;
            url: string;
          };
        };
      }

      const discussionResponse =
        await octokit.graphql<CreateDiscussionResponse>(
          CREATE_DISCUSSION_MUTATION,
          {
            repositoryId: repoId,
            categoryId: category.id,
            title: `[TEST] ${fixture.discussion.title}`,
            body: fixture.discussion.body,
          },
        );

      const discussion = discussionResponse.createDiscussion?.discussion;
      if (discussion) {
        result.discussion_number = discussion.number;
        core.info(
          `Created discussion #${discussion.number}: ${discussion.url}`,
        );

        // Add comment to discussion if specified
        if (fixture.comment) {
          await octokit.graphql(ADD_DISCUSSION_COMMENT_MUTATION, {
            discussionId: discussion.id,
            body: fixture.comment.body,
          });
          core.info("Added comment to discussion");
        }
      }
    }
  }

  return result;
}

/**
 * Verify the outcome of a test fixture
 */
async function verifyFixture(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  fixture: TestFixture,
  projectNumber: number,
): Promise<VerificationResult> {
  const errors: VerificationError[] = [];

  if (!fixture.expected) {
    return { passed: true, errors: [] };
  }

  // Get parent issue state
  interface ProjectQueryResponse {
    repository?: {
      issue?: {
        id?: string;
        state?: string;
        projectItems?: {
          nodes?: Array<{
            project?: { number?: number };
            fieldValues?: {
              nodes?: Array<{
                name?: string;
                number?: number;
                field?: { name?: string };
              }>;
            };
          }>;
        };
      };
    };
  }

  const response = await octokit.graphql<ProjectQueryResponse>(
    GET_PROJECT_ITEM_QUERY,
    {
      org: owner,
      repo,
      issueNumber,
      projectNumber,
    },
  );

  const issue = response.repository?.issue;
  if (!issue) {
    errors.push({
      field: "issue",
      expected: "exists",
      actual: "not found",
    });
    return { passed: false, errors };
  }

  // Check issue state
  if (fixture.expected.issue_state) {
    const actualState = issue.state?.toLowerCase() || "unknown";
    if (actualState !== fixture.expected.issue_state) {
      errors.push({
        field: "issue_state",
        expected: fixture.expected.issue_state,
        actual: actualState,
      });
    }
  }

  // Check project status
  if (fixture.expected.parent_status) {
    const projectItems = issue.projectItems?.nodes || [];
    const projectItem = projectItems.find(
      (item) => item.project?.number === projectNumber,
    );

    if (!projectItem) {
      errors.push({
        field: "parent_status",
        expected: fixture.expected.parent_status,
        actual: "not in project",
      });
    } else {
      let actualStatus = "unknown";
      for (const fieldValue of projectItem.fieldValues?.nodes || []) {
        if (fieldValue.field?.name === "Status" && fieldValue.name) {
          actualStatus = fieldValue.name;
          break;
        }
      }

      if (actualStatus !== fixture.expected.parent_status) {
        errors.push({
          field: "parent_status",
          expected: fixture.expected.parent_status,
          actual: actualStatus,
        });
      }
    }
  }

  // Check iteration count
  if (fixture.expected.min_iteration !== undefined) {
    const projectItems = issue.projectItems?.nodes || [];
    const projectItem = projectItems.find(
      (item) => item.project?.number === projectNumber,
    );

    if (projectItem) {
      let actualIteration = 0;
      for (const fieldValue of projectItem.fieldValues?.nodes || []) {
        if (
          fieldValue.field?.name === "Iteration" &&
          typeof fieldValue.number === "number"
        ) {
          actualIteration = fieldValue.number;
          break;
        }
      }

      if (actualIteration < fixture.expected.min_iteration) {
        errors.push({
          field: "min_iteration",
          expected: `>= ${fixture.expected.min_iteration}`,
          actual: String(actualIteration),
        });
      }
    }
  }

  // Check failures count
  if (fixture.expected.failures !== undefined) {
    const projectItems = issue.projectItems?.nodes || [];
    const projectItem = projectItems.find(
      (item) => item.project?.number === projectNumber,
    );

    if (projectItem) {
      let actualFailures = 0;
      for (const fieldValue of projectItem.fieldValues?.nodes || []) {
        if (
          fieldValue.field?.name === "Failures" &&
          typeof fieldValue.number === "number"
        ) {
          actualFailures = fieldValue.number;
          break;
        }
      }

      if (actualFailures !== fixture.expected.failures) {
        errors.push({
          field: "failures",
          expected: String(fixture.expected.failures),
          actual: String(actualFailures),
        });
      }
    }
  }

  // Check sub-issue statuses
  if (
    fixture.expected.sub_issue_statuses &&
    fixture.expected.sub_issue_statuses.length > 0
  ) {
    interface SubIssuesResponse {
      repository?: {
        issue?: {
          subIssues?: {
            nodes?: Array<{
              number?: number;
              projectItems?: {
                nodes?: Array<{
                  project?: { number?: number };
                  fieldValues?: {
                    nodes?: Array<{
                      name?: string;
                      field?: { name?: string };
                    }>;
                  };
                }>;
              };
            }>;
          };
        };
      };
    }

    const subResponse = await octokit.graphql<SubIssuesResponse>(
      GET_SUB_ISSUES_QUERY,
      {
        org: owner,
        repo,
        parentNumber: issueNumber,
      },
    );

    const subIssues = subResponse.repository?.issue?.subIssues?.nodes || [];
    const sortedSubIssues = [...subIssues].sort(
      (a, b) => (a.number || 0) - (b.number || 0),
    );

    for (let i = 0; i < fixture.expected.sub_issue_statuses.length; i++) {
      const expectedStatus = fixture.expected.sub_issue_statuses[i];
      if (!expectedStatus) continue;

      const subIssue = sortedSubIssues[i];
      if (!subIssue) {
        errors.push({
          field: `sub_issue_${i + 1}_status`,
          expected: expectedStatus,
          actual: "not found",
        });
        continue;
      }

      const projectItem = subIssue.projectItems?.nodes?.find(
        (item) => item.project?.number === projectNumber,
      );

      let actualStatus = "unknown";
      if (projectItem) {
        for (const fieldValue of projectItem.fieldValues?.nodes || []) {
          if (fieldValue.field?.name === "Status" && fieldValue.name) {
            actualStatus = fieldValue.name;
            break;
          }
        }
      }

      if (actualStatus !== expectedStatus) {
        errors.push({
          field: `sub_issue_${i + 1}_status`,
          expected: expectedStatus,
          actual: actualStatus,
        });
      }
    }
  }

  // Check expected labels
  if (fixture.expected.labels && fixture.expected.labels.length > 0) {
    const { data: issueData } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const actualLabels = issueData.labels.map((l) =>
      typeof l === "string" ? l : l.name || "",
    );

    for (const expectedLabel of fixture.expected.labels) {
      if (!actualLabels.includes(expectedLabel)) {
        errors.push({
          field: "labels",
          expected: expectedLabel,
          actual: `not found (has: ${actualLabels.join(", ")})`,
        });
      }
    }
  }

  // Check minimum comment count
  if (fixture.expected.min_comments !== undefined) {
    // Check issue comments
    if (fixture.parent_issue) {
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      });

      if (comments.length < fixture.expected.min_comments) {
        errors.push({
          field: "min_comments",
          expected: `>= ${fixture.expected.min_comments}`,
          actual: String(comments.length),
        });
      }
    }

    // Check discussion comments
    if (fixture.discussion) {
      // Discussion verification would require tracking discussion_number separately
      // For now, discussions are created but verification is not implemented
      // TODO: Implement discussion verification
      core.info(
        "Discussion verification not yet implemented - skipping discussion checks",
      );
    }
  }

  // Check PR state
  if (fixture.expected.pr_state) {
    // Find PR for this issue
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "all",
      per_page: 100,
    });

    const testPr = prs.find(
      (pr) =>
        pr.body?.includes(`Fixes #${issueNumber}`) ||
        pr.title.includes("[TEST]"),
    );

    if (!testPr) {
      errors.push({
        field: "pr_state",
        expected: fixture.expected.pr_state,
        actual: "not found",
      });
    } else {
      let actualState: string;
      if (testPr.merged_at) {
        actualState = "merged";
      } else if (testPr.draft) {
        actualState = "draft";
      } else {
        actualState = testPr.state;
      }

      if (actualState !== fixture.expected.pr_state) {
        errors.push({
          field: "pr_state",
          expected: fixture.expected.pr_state,
          actual: actualState,
        });
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Cleanup a test fixture
 */
async function cleanupFixture(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  core.info(`Cleaning up test fixture for issue #${issueNumber}`);

  // Get sub-issues first
  interface SubIssuesResponse {
    repository?: {
      issue?: {
        subIssues?: {
          nodes?: Array<{
            number?: number;
          }>;
        };
      };
    };
  }

  const subResponse = await octokit.graphql<SubIssuesResponse>(
    GET_SUB_ISSUES_QUERY,
    {
      org: owner,
      repo,
      parentNumber: issueNumber,
    },
  );

  const subIssues = subResponse.repository?.issue?.subIssues?.nodes || [];

  // Find and close/delete any PRs associated with test issues
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 100,
  });

  for (const pr of prs) {
    if (
      pr.title.includes("[TEST]") &&
      (pr.body?.includes(`#${issueNumber}`) ||
        subIssues.some((sub) => pr.body?.includes(`#${sub.number}`)))
    ) {
      core.info(`Closing PR #${pr.number}`);
      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        state: "closed",
      });

      // Delete the branch
      if (pr.head.ref.startsWith("test/")) {
        try {
          await octokit.rest.git.deleteRef({
            owner,
            repo,
            ref: `heads/${pr.head.ref}`,
          });
          core.info(`Deleted branch ${pr.head.ref}`);
        } catch (error) {
          core.warning(`Failed to delete branch ${pr.head.ref}: ${error}`);
        }
      }
    }
  }

  // Close sub-issues
  for (const subIssue of subIssues) {
    if (subIssue.number) {
      core.info(`Closing sub-issue #${subIssue.number}`);
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: subIssue.number,
        state: "closed",
      });
    }
  }

  // Close parent issue
  core.info(`Closing parent issue #${issueNumber}`);
  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: "closed",
  });

  // Delete any test branches that might be orphaned
  try {
    const { data: refs } = await octokit.rest.git.listMatchingRefs({
      owner,
      repo,
      ref: "heads/test/",
    });

    for (const ref of refs) {
      if (ref.ref.includes(String(issueNumber))) {
        core.info(`Deleting orphaned branch ${ref.ref}`);
        await octokit.rest.git.deleteRef({
          owner,
          repo,
          ref: ref.ref.replace("refs/", ""),
        });
      }
    }
  } catch (error) {
    core.warning(`Failed to cleanup orphaned branches: ${error}`);
  }

  core.info("Cleanup complete");
}

async function run(): Promise<void> {
  try {
    const action = getRequiredInput("action");
    const token = getRequiredInput("github_token");
    const projectNumber = parseInt(
      getOptionalInput("project_number") || "1",
      10,
    );
    const stepwiseMode = getOptionalInput("stepwise_mode") === "true";

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Set GH_TOKEN for CLI commands
    process.env.GH_TOKEN = token;

    if (action === "create") {
      const fixtureJson = getRequiredInput("fixture_json");
      const fixture = JSON.parse(fixtureJson) as TestFixture;

      core.info(`Creating test fixture: ${fixture.name}`);
      core.info(`Description: ${fixture.description}`);

      const result = await createFixture(
        octokit,
        owner,
        repo,
        fixture,
        projectNumber,
        stepwiseMode,
      );

      setOutputs({
        issue_number: String(result.issue_number),
        sub_issue_numbers: JSON.stringify(result.sub_issue_numbers),
        branch_name: result.branch_name || "",
        pr_number: result.pr_number ? String(result.pr_number) : "",
        discussion_number: result.discussion_number
          ? String(result.discussion_number)
          : "",
        comment_id: result.comment_id || "",
      });

      core.info("Fixture creation complete");
      return;
    }

    if (action === "verify") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
      const fixtureJson = getRequiredInput("fixture_json");
      const fixture = JSON.parse(fixtureJson) as TestFixture;

      core.info(`Verifying fixture for issue #${issueNumber}`);

      const result = await verifyFixture(
        octokit,
        owner,
        repo,
        issueNumber,
        fixture,
        projectNumber,
      );

      if (result.passed) {
        core.info("All verifications passed!");
      } else {
        core.warning(
          `Verification failed with ${result.errors.length} errors:`,
        );
        for (const error of result.errors) {
          core.warning(
            `  ${error.field}: expected ${error.expected}, got ${error.actual}`,
          );
        }
      }

      setOutputs({
        verification_passed: String(result.passed),
        verification_errors: JSON.stringify(result.errors),
      });

      if (!result.passed) {
        core.setFailed(
          `Verification failed with ${result.errors.length} errors`,
        );
      }
      return;
    }

    if (action === "cleanup") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);

      await cleanupFixture(octokit, owner, repo, issueNumber);

      setOutputs({
        success: "true",
      });
      return;
    }

    core.setFailed(`Unknown action: ${action}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
