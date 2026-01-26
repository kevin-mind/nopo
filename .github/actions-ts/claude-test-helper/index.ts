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
  dryRunMode: boolean = false,
): Promise<FixtureCreationResult> {
  const result: FixtureCreationResult = {
    issue_number: 0,
    sub_issue_numbers: [],
  };

  // Label strategy for test mode:
  // - dry-run mode: test:automation + _e2e (workflows skip, but cleanup works)
  // - stepwise mode: test:automation + _test (detection only, pause for verification)
  // - e2e mode: test:automation + _e2e (full execution)
  // Note: dry-run and e2e both use _e2e label so cleanup safety check passes
  const testModeLabel = dryRunMode ? ["_e2e"] : stepwiseMode ? ["_test"] : ["_e2e"];

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
    ...testModeLabel,
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
    core.info(
      `Project query result - org: ${owner}, projectNumber: ${projectNumber}`,
    );
    core.info(`Project data: ${JSON.stringify(projectData)}`);
    projectFields = parseProjectFields(projectData);
    if (projectFields) {
      core.info(
        `Parsed project fields - projectId: ${projectFields.projectId}`,
      );
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
          // Case-insensitive lookup for status option
          const optionId =
            projectFields.statusOptions[statusValue] ||
            Object.entries(projectFields.statusOptions).find(
              ([name]) => name.toLowerCase() === statusValue.toLowerCase(),
            )?.[1];
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

        // Set iteration if specified and field exists
        if (
          fixture.parent_issue.project_fields.Iteration !== undefined &&
          projectFields.iterationFieldId
        ) {
          await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
            projectId: projectFields.projectId,
            itemId,
            fieldId: projectFields.iterationFieldId,
            value: { number: fixture.parent_issue.project_fields.Iteration },
          });
          core.info(
            `Set parent Iteration to ${fixture.parent_issue.project_fields.Iteration}`,
          );
        } else if (
          fixture.parent_issue.project_fields.Iteration !== undefined
        ) {
          core.warning(
            "Iteration field not found in project - skipping Iteration update",
          );
        }

        // Set failures if specified and field exists
        if (
          fixture.parent_issue.project_fields.Failures !== undefined &&
          projectFields.failuresFieldId
        ) {
          await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
            projectId: projectFields.projectId,
            itemId,
            fieldId: projectFields.failuresFieldId,
            value: { number: fixture.parent_issue.project_fields.Failures },
          });
          core.info(
            `Set parent Failures to ${fixture.parent_issue.project_fields.Failures}`,
          );
        } else if (fixture.parent_issue.project_fields.Failures !== undefined) {
          core.warning(
            "Failures field not found in project - skipping Failures update",
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

      const subTitle = `[Phase ${i + 1}] ${subConfig.title}`;

      core.info(`Creating sub-issue: ${subTitle}`);

      // Replace placeholders in body - {PARENT_NUMBER} is known, {ISSUE_NUMBER} will be the sub-issue number
      // We'll update the body after creation to replace {ISSUE_NUMBER}
      const bodyWithParent = subConfig.body.replace(
        /\{PARENT_NUMBER\}/g,
        String(parentIssue.number),
      );

      const { data: subIssue } = await octokit.rest.issues.create({
        owner,
        repo,
        title: subTitle,
        body: bodyWithParent,
        labels: ["test:automation", "triaged", ...testModeLabel],
      });

      // Now update body to replace {ISSUE_NUMBER} with actual sub-issue number
      const finalBody = bodyWithParent.replace(
        /\{ISSUE_NUMBER\}/g,
        String(subIssue.number),
      );
      if (finalBody !== bodyWithParent) {
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: subIssue.number,
          body: finalBody,
        });
      }

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
        const subStatus = subConfig.project_fields?.Status;
        if (subItemId && subStatus) {
          // Case-insensitive lookup for status option
          const optionId =
            projectFields.statusOptions[subStatus] ||
            Object.entries(projectFields.statusOptions).find(
              ([name]) => name.toLowerCase() === subStatus.toLowerCase(),
            )?.[1];
          if (optionId) {
            await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
              projectId: projectFields.projectId,
              itemId: subItemId,
              fieldId: projectFields.statusFieldId,
              value: { singleSelectOptionId: optionId },
            });
            core.info(
              `Set sub-issue #${subIssue.number} Status to ${subStatus}`,
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

    // Add test:automation label and test mode label to PR
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pr.number,
      labels: ["test:automation", ...testModeLabel],
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

  // Check iteration count - sum iterations from all sub-issues
  // (iteration is tracked per-sub-issue, not on the parent)
  if (fixture.expected.min_iteration !== undefined) {
    interface SubIssueIterationResponse {
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
                      field?: { name?: string };
                      number?: number;
                    }>;
                  };
                }>;
              };
            }>;
          };
        };
      };
    }

    const subIterationResponse =
      await octokit.graphql<SubIssueIterationResponse>(
        `query GetSubIssueIterations($org: String!, $repo: String!, $parentNumber: Int!) {
      repository(owner: $org, name: $repo) {
        issue(number: $parentNumber) {
          subIssues(first: 20) {
            nodes {
              number
              projectItems(first: 10) {
                nodes {
                  project { number }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldNumberValue {
                        number
                        field { ... on ProjectV2Field { name } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
        {
          org: owner,
          repo,
          parentNumber: issueNumber,
        },
      );

    const subIssues =
      subIterationResponse.repository?.issue?.subIssues?.nodes || [];

    // Sum up iterations from all sub-issues
    let totalIteration = 0;
    for (const subIssue of subIssues) {
      const projectItem = subIssue.projectItems?.nodes?.find(
        (item) => item.project?.number === projectNumber,
      );
      if (projectItem) {
        for (const fieldValue of projectItem.fieldValues?.nodes || []) {
          if (
            fieldValue.field?.name === "Iteration" &&
            typeof fieldValue.number === "number"
          ) {
            totalIteration += fieldValue.number;
            break;
          }
        }
      }
    }

    if (totalIteration < fixture.expected.min_iteration) {
      errors.push({
        field: "min_iteration",
        expected: `>= ${fixture.expected.min_iteration}`,
        actual: String(totalIteration),
      });
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

  // Check all sub-issues are closed
  if (fixture.expected.all_sub_issues_closed) {
    interface SubIssuesResponse {
      repository?: {
        issue?: {
          subIssues?: {
            nodes?: Array<{
              number?: number;
              state?: string;
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

    for (let i = 0; i < subIssues.length; i++) {
      const subIssue = subIssues[i];
      if (subIssue?.number) {
        const { data: subIssueData } = await octokit.rest.issues.get({
          owner,
          repo,
          issue_number: subIssue.number,
        });
        if (subIssueData.state !== "closed") {
          errors.push({
            field: `sub_issue_${i + 1}_closed`,
            expected: "closed",
            actual: subIssueData.state,
          });
        }
      }
    }
  }

  // Check sub-issue todos are done (checkboxes checked)
  if (fixture.expected.sub_issues_todos_done) {
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

    for (let i = 0; i < subIssues.length; i++) {
      const subIssue = subIssues[i];
      if (subIssue?.number) {
        const { data: subIssueData } = await octokit.rest.issues.get({
          owner,
          repo,
          issue_number: subIssue.number,
        });
        const body = subIssueData.body || "";
        const unchecked = (body.match(/- \[ \]/g) || []).length;
        if (unchecked > 0) {
          errors.push({
            field: `sub_issue_${i + 1}_todos`,
            expected: "all checked",
            actual: `${unchecked} unchecked`,
          });
        }
      }
    }
  }

  // Check iteration history has expected log entries
  if (fixture.expected.history_contains) {
    const { data: issueData } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    const body = issueData.body || "";
    for (const pattern of fixture.expected.history_contains) {
      if (!body.includes(pattern)) {
        errors.push({
          field: "iteration_history",
          expected: `contains "${pattern}"`,
          actual: "not found",
        });
      }
    }
  }

  // Check each sub-issue has a merged PR
  if (fixture.expected.sub_issues_have_merged_pr) {
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

    const { data: allPrs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "all",
      per_page: 100,
    });

    for (let i = 0; i < subIssues.length; i++) {
      const subIssue = subIssues[i];
      if (subIssue?.number) {
        const pr = allPrs.find(
          (p) => p.body?.includes(`Fixes #${subIssue.number}`) && p.merged_at,
        );
        if (!pr) {
          errors.push({
            field: `sub_issue_${i + 1}_pr`,
            expected: "merged PR",
            actual: "no merged PR found",
          });
        }
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
 *
 * SAFETY: Only cleans up issues that have the `_e2e` label to prevent
 * accidentally closing real issues.
 */
async function cleanupFixture(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<void> {
  core.info(`Cleaning up test fixture for issue #${issueNumber}`);

  // SAFETY CHECK: Verify the issue has the _e2e label before proceeding
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const labels = issue.labels.map((l) =>
    typeof l === "string" ? l : l.name || "",
  );

  if (!labels.includes("_e2e")) {
    throw new Error(
      `SAFETY: Refusing to cleanup issue #${issueNumber} - it does not have the _e2e label. ` +
        `Labels found: [${labels.join(", ")}]. ` +
        `Only issues with the _e2e label can be cleaned up to prevent accidentally closing real issues.`,
    );
  }

  core.info(`Safety check passed: Issue #${issueNumber} has _e2e label`);

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

  // Close all issues with proper status updates using the shared function
  await closeIssueAndSubIssues(
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
  );

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

/**
 * Reset an issue to initial state (re-open and set to Backlog/Ready)
 *
 * This is useful for recovering from accidentally closed issues or
 * restarting work on an issue.
 */
async function resetIssue(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<{ reset_count: number }> {
  core.info(`Resetting issue #${issueNumber} to initial state`);
  let resetCount = 0;

  // Get project fields
  interface ProjectQueryResponse {
    organization?: {
      projectV2?: unknown;
    };
  }

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
    projectFields = parseProjectFields(projectData);
  } catch (error) {
    core.warning(
      `Could not access project #${projectNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Get parent issue and re-open it
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  if (issue.state === "closed") {
    core.info(`Re-opening parent issue #${issueNumber}`);
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: "open",
    });
    resetCount++;
  }

  // Set parent status to Backlog
  if (projectFields) {
    await setIssueProjectStatus(
      octokit,
      owner,
      repo,
      issueNumber,
      "Backlog",
      projectFields,
    );
    core.info(`Set parent issue #${issueNumber} status to Backlog`);
  }

  // Get sub-issues
  interface SubIssuesResponse {
    repository?: {
      issue?: {
        subIssues?: {
          nodes?: Array<{
            number?: number;
            state?: string;
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

  // Re-open and reset each sub-issue
  for (const subIssue of subIssues) {
    if (subIssue.number) {
      const { data: subIssueData } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: subIssue.number,
      });

      if (subIssueData.state === "closed") {
        core.info(`Re-opening sub-issue #${subIssue.number}`);
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: subIssue.number,
          state: "open",
        });
        resetCount++;
      }

      // Set sub-issue status to Ready
      if (projectFields) {
        await setIssueProjectStatus(
          octokit,
          owner,
          repo,
          subIssue.number,
          "Ready",
          projectFields,
        );
        core.info(`Set sub-issue #${subIssue.number} status to Ready`);
      }
    }
  }

  core.info(`Reset complete: ${resetCount} issues re-opened, statuses updated`);
  return { reset_count: resetCount };
}

/**
 * Close an issue and all its sub-issues, setting statuses to Done
 *
 * This is useful for quickly closing an issue tree without going through
 * the normal workflow.
 */
async function closeIssueAndSubIssues(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<{ close_count: number }> {
  core.info(`Closing issue #${issueNumber} and all sub-issues`);
  let closeCount = 0;

  // Get project fields
  interface ProjectQueryResponse {
    organization?: {
      projectV2?: unknown;
    };
  }

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
    projectFields = parseProjectFields(projectData);
  } catch (error) {
    core.warning(
      `Could not access project #${projectNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Get sub-issues first
  interface SubIssuesResponse {
    repository?: {
      issue?: {
        subIssues?: {
          nodes?: Array<{
            number?: number;
            state?: string;
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

  // Close all sub-issues first
  for (const subIssue of subIssues) {
    if (subIssue.number) {
      // Set status to Done
      if (projectFields) {
        await setIssueProjectStatus(
          octokit,
          owner,
          repo,
          subIssue.number,
          "Done",
          projectFields,
        );
        core.info(`Set sub-issue #${subIssue.number} status to Done`);
      }

      // Close if open
      const { data: subIssueData } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: subIssue.number,
      });

      if (subIssueData.state === "open") {
        core.info(`Closing sub-issue #${subIssue.number}`);
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: subIssue.number,
          state: "closed",
          state_reason: "completed",
        });
        closeCount++;
      }
    }
  }

  // Set parent status to Done
  if (projectFields) {
    await setIssueProjectStatus(
      octokit,
      owner,
      repo,
      issueNumber,
      "Done",
      projectFields,
    );
    core.info(`Set parent issue #${issueNumber} status to Done`);
  }

  // Close parent issue
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  if (issue.state === "open") {
    core.info(`Closing parent issue #${issueNumber}`);
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: "closed",
      state_reason: "completed",
    });
    closeCount++;
  }

  return { close_count: closeCount };
}

/**
 * Delete an issue and all its sub-issues
 *
 * IMPORTANT: This permanently deletes the issues and cannot be undone!
 * Only works for issues with the _e2e label to prevent accidental deletion
 * of real issues.
 */
async function deleteIssueAndSubIssues(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ delete_count: number }> {
  core.info(`Deleting issue #${issueNumber} and all sub-issues`);
  let deleteCount = 0;

  // SAFETY CHECK: Verify the issue has the _e2e label
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const labels = issue.labels.map((l) =>
    typeof l === "string" ? l : l.name || "",
  );

  if (!labels.includes("_e2e")) {
    throw new Error(
      `SAFETY: Refusing to delete issue #${issueNumber} - it does not have the _e2e label. ` +
        `Labels found: [${labels.join(", ")}]. ` +
        `Only issues with the _e2e label can be deleted to prevent accidentally deleting real issues.`,
    );
  }

  // Get sub-issues
  interface SubIssuesResponse {
    repository?: {
      issue?: {
        subIssues?: {
          nodes?: Array<{
            number?: number;
            node_id?: string;
          }>;
        };
      };
    };
  }

  const subResponse = await octokit.graphql<SubIssuesResponse>(
    `query GetSubIssues($org: String!, $repo: String!, $parentNumber: Int!) {
      repository(owner: $org, name: $repo) {
        issue(number: $parentNumber) {
          subIssues(first: 20) {
            nodes {
              number
              node_id: id
            }
          }
        }
      }
    }`,
    {
      org: owner,
      repo,
      parentNumber: issueNumber,
    },
  );

  const subIssues = subResponse.repository?.issue?.subIssues?.nodes || [];

  // Delete all sub-issues first
  for (const subIssue of subIssues) {
    if (subIssue.node_id) {
      core.info(`Deleting sub-issue #${subIssue.number}`);
      try {
        await octokit.graphql(
          `mutation DeleteIssue($issueId: ID!) {
            deleteIssue(input: { issueId: $issueId }) {
              clientMutationId
            }
          }`,
          { issueId: subIssue.node_id },
        );
        deleteCount++;
      } catch (error) {
        core.warning(
          `Failed to delete sub-issue #${subIssue.number}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Delete parent issue
  core.info(`Deleting parent issue #${issueNumber}`);
  try {
    await octokit.graphql(
      `mutation DeleteIssue($issueId: ID!) {
        deleteIssue(input: { issueId: $issueId }) {
          clientMutationId
        }
      }`,
      { issueId: issue.node_id },
    );
    deleteCount++;
  } catch (error) {
    core.warning(
      `Failed to delete parent issue #${issueNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }

  return { delete_count: deleteCount };
}

/**
 * Helper to set issue project status
 */
async function setIssueProjectStatus(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  status: string,
  projectFields: ProjectFields,
): Promise<void> {
  // Get issue node ID
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const issueNodeId = issue.node_id;

  // Check if issue is in project, add if not
  interface ProjectItemsResponse {
    repository?: {
      issue?: {
        projectItems?: {
          nodes?: Array<{
            id?: string;
            project?: { number?: number };
          }>;
        };
      };
    };
  }

  const projectItemsResponse = await octokit.graphql<ProjectItemsResponse>(
    `query GetIssueProjectItems($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          projectItems(first: 10) {
            nodes {
              id
              project { number }
            }
          }
        }
      }
    }`,
    { owner, repo, issueNumber },
  );

  const projectItems =
    projectItemsResponse.repository?.issue?.projectItems?.nodes || [];
  let projectItemId = projectItems.find(
    (item) => item.project?.number === parseInt(projectFields.projectId, 10),
  )?.id;

  // If not in project, add it
  if (!projectItemId) {
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
    projectItemId = addResult.addProjectV2ItemById?.item?.id;
  }

  if (!projectItemId) {
    core.warning(`Could not get project item ID for issue #${issueNumber}`);
    return;
  }

  // Set status
  const optionId =
    projectFields.statusOptions[status] ||
    Object.entries(projectFields.statusOptions).find(
      ([name]) => name.toLowerCase() === status.toLowerCase(),
    )?.[1];

  if (optionId) {
    await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
      projectId: projectFields.projectId,
      itemId: projectItemId,
      fieldId: projectFields.statusFieldId,
      value: { singleSelectOptionId: optionId },
    });
  }
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
    const dryRunMode = getOptionalInput("dry_run_mode") === "true";

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
        dryRunMode,
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

      await cleanupFixture(octokit, owner, repo, issueNumber, projectNumber);

      setOutputs({
        success: "true",
      });
      return;
    }

    if (action === "reset") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);

      const result = await resetIssue(
        octokit,
        owner,
        repo,
        issueNumber,
        projectNumber,
      );

      setOutputs({
        success: "true",
        reset_count: String(result.reset_count),
      });
      return;
    }

    if (action === "close") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);

      const result = await closeIssueAndSubIssues(
        octokit,
        owner,
        repo,
        issueNumber,
        projectNumber,
      );

      setOutputs({
        success: "true",
        close_count: String(result.close_count),
      });
      return;
    }

    if (action === "delete") {
      const issueNumber = parseInt(getRequiredInput("issue_number"), 10);

      const result = await deleteIssueAndSubIssues(
        octokit,
        owner,
        repo,
        issueNumber,
      );

      setOutputs({
        success: "true",
        delete_count: String(result.delete_count),
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
