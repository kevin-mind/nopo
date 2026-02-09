import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  replaceBody,
  extractTodosFromAst,
} from "@more/statemachine";
import {
  parseIssue,
  createIssue,
  createComment,
  listComments,
  setLabels,
  parseMarkdown,
  type OctokitLike,
} from "@more/issue-state";
import type {
  TestFixture,
  FixtureCreationResult,
  VerificationResult,
  VerificationError,
} from "./types.js";

function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return octokit as unknown as OctokitLike;
}

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

const GET_LABEL_IDS_QUERY = `
query GetLabelIds($owner: String!, $repo: String!, $labelNames: [String!]!) {
  repository(owner: $owner, name: $repo) {
    labels(first: 100, query: "") {
      nodes {
        id
        name
      }
    }
  }
}
`;

const ADD_LABELS_TO_LABELABLE_MUTATION = `
mutation AddLabelsToLabelable($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: {
    labelableId: $labelableId
    labelIds: $labelIds
  }) {
    labelable {
      ... on Discussion {
        id
      }
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

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- projectData is typed as unknown, casting to locally defined Project interface
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
 * Add labels to a discussion using GraphQL
 */
async function addLabelsToDiscussion(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  discussionId: string,
  labelNames: string[],
): Promise<void> {
  if (labelNames.length === 0) return;

  // First, get the label IDs for the given label names
  interface LabelsResponse {
    repository?: {
      labels?: {
        nodes?: Array<{
          id: string;
          name: string;
        }>;
      };
    };
  }

  const labelsResponse = await octokit.graphql<LabelsResponse>(
    GET_LABEL_IDS_QUERY,
    { owner, repo, labelNames },
  );

  const allLabels = labelsResponse.repository?.labels?.nodes ?? [];
  const labelIds: string[] = [];

  for (const labelName of labelNames) {
    const label = allLabels.find(
      (l) => l.name.toLowerCase() === labelName.toLowerCase(),
    );
    if (label) {
      labelIds.push(label.id);
    } else {
      core.warning(`Label "${labelName}" not found in repository`);
    }
  }

  if (labelIds.length === 0) {
    core.warning("No valid labels found to add to discussion");
    return;
  }

  // Add labels to the discussion
  await octokit.graphql(ADD_LABELS_TO_LABELABLE_MUTATION, {
    labelableId: discussionId,
    labelIds,
  });

  core.info(`Added ${labelIds.length} labels to discussion`);
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
  reviewOctokit?: ReturnType<typeof github.getOctokit>,
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

          // Add labels to discussion if specified
          if (
            fixture.discussion.labels &&
            fixture.discussion.labels.length > 0
          ) {
            await addLabelsToDiscussion(
              octokit,
              owner,
              repo,
              discussion.id,
              fixture.discussion.labels,
            );
          }

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
    ...(fixture.parent_issue.labels || []),
  ];

  core.info(`Creating parent issue: ${parentTitle}`);

  const createResult = await createIssue(
    owner,
    repo,
    {
      title: parentTitle,
      body: fixture.parent_issue.body,
      labels: parentLabels,
    },
    { octokit: asOctokitLike(octokit) },
  );

  result.issue_number = createResult.issueNumber;
  const issueNodeId = createResult.issueId; // Use node ID from createIssue
  core.info(`Created parent issue #${createResult.issueNumber}`);
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
        String(createResult.issueNumber),
      );

      const subCreateResult = await createIssue(
        owner,
        repo,
        {
          title: subTitle,
          body: bodyWithParent,
          labels: ["test:automation", "triaged"],
        },
        { octokit: asOctokitLike(octokit) },
      );

      // Now update body to replace {ISSUE_NUMBER} with actual sub-issue number
      const finalBody = bodyWithParent.replace(
        /\{ISSUE_NUMBER\}/g,
        String(subCreateResult.issueNumber),
      );
      if (finalBody !== bodyWithParent) {
        const { data: subState, update: updateSub } = await parseIssue(
          owner,
          repo,
          subCreateResult.issueNumber,
          {
            octokit: asOctokitLike(octokit),
            fetchPRs: false,
            fetchParent: false,
          },
        );
        const updatedSubState = replaceBody(
          { bodyAst: parseMarkdown(finalBody) },
          subState,
        );
        await updateSub(updatedSubState);
      }

      result.sub_issue_numbers.push(subCreateResult.issueNumber);
      core.info(`Created sub-issue #${subCreateResult.issueNumber}`);

      // Link sub-issue to parent using GraphQL
      try {
        await octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
          parentId: issueNodeId,
          subIssueId: subCreateResult.issueId,
        });
        core.info(
          `Linked sub-issue #${subCreateResult.issueNumber} to parent #${createResult.issueNumber}`,
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
            contentId: subCreateResult.issueId,
          },
        );

        const subItemId = addResult.addProjectV2ItemById?.item?.id;
        if (subItemId) {
          // Set Status if specified
          const subStatus = subConfig.project_fields?.Status;
          if (subStatus) {
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
                `Set sub-issue #${subCreateResult.issueNumber} Status to ${subStatus}`,
              );
            }
          }

          // Set Iteration if specified
          if (
            subConfig.project_fields?.Iteration !== undefined &&
            projectFields.iterationFieldId
          ) {
            await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
              projectId: projectFields.projectId,
              itemId: subItemId,
              fieldId: projectFields.iterationFieldId,
              value: { number: subConfig.project_fields.Iteration },
            });
            core.info(
              `Set sub-issue #${subCreateResult.issueNumber} Iteration to ${subConfig.project_fields.Iteration}`,
            );
          }

          // Set Failures if specified
          if (
            subConfig.project_fields?.Failures !== undefined &&
            projectFields.failuresFieldId
          ) {
            await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
              projectId: projectFields.projectId,
              itemId: subItemId,
              fieldId: projectFields.failuresFieldId,
              value: { number: subConfig.project_fields.Failures },
            });
            core.info(
              `Set sub-issue #${subCreateResult.issueNumber} Failures to ${subConfig.project_fields.Failures}`,
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

        // Get first sub-issue number for placeholder replacement
        const firstSubIssueNumber = result.sub_issue_numbers[0];

        for (const [rawPath, rawContent] of Object.entries(commit.files)) {
          // Replace placeholders in path and content
          let path = rawPath;
          let content = rawContent;

          if (firstSubIssueNumber) {
            path = path.replace(
              /\{SUB_ISSUE_NUMBER\}/g,
              String(firstSubIssueNumber),
            );
            content = content.replace(
              /\{SUB_ISSUE_NUMBER\}/g,
              String(firstSubIssueNumber),
            );
          }

          // Also replace parent issue number
          path = path.replace(/\{ISSUE_NUMBER\}/g, String(result.issue_number));
          content = content.replace(
            /\{ISSUE_NUMBER\}/g,
            String(result.issue_number),
          );

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

    // Replace placeholders in PR body
    const firstSubIssueNumber = result.sub_issue_numbers[0];
    let prBody = fixture.pr.body;

    // Replace {SUB_ISSUE_NUMBER} with first sub-issue number
    if (firstSubIssueNumber) {
      prBody = prBody.replace(
        /\{SUB_ISSUE_NUMBER\}/g,
        String(firstSubIssueNumber),
      );
    }

    // Replace {ISSUE_NUMBER} with parent issue number
    prBody = prBody.replace(/\{ISSUE_NUMBER\}/g, String(result.issue_number));

    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `[TEST] ${fixture.pr.title}`,
      body: prBody,
      head: result.branch_name,
      base: "main",
      draft: fixture.pr.draft ?? true, // Default to draft
    });

    result.pr_number = pr.number;
    core.info(`Created PR #${pr.number}`);

    // Add test:automation label to PR
    await setLabels(
      owner,
      repo,
      pr.number,
      ["test:automation"],
      asOctokitLike(octokit),
    );

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
    const { commentId } = await createComment(
      owner,
      repo,
      result.issue_number,
      fixture.comment.body,
      asOctokitLike(octokit),
    );
    result.comment_id = String(commentId);
    core.info(`Created comment ${commentId}`);
  }

  // Create review on PR if specified
  // IMPORTANT: Must use reviewOctokit (different user) to avoid self-review error
  if (fixture.review && result.pr_number) {
    if (!reviewOctokit) {
      throw new Error(
        "Test fixture requires review but no github_review_token provided. " +
          "Set CLAUDE_REVIEWER_PAT secret or remove 'review' from fixture.",
      );
    }

    core.info(`Submitting review with state: ${fixture.review.state}`);

    const eventMap: Record<string, "APPROVE" | "REQUEST_CHANGES" | "COMMENT"> =
      {
        approve: "APPROVE",
        request_changes: "REQUEST_CHANGES",
        comment: "COMMENT",
      };

    await reviewOctokit.rest.pulls.createReview({
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

        // Add labels to discussion if specified
        if (fixture.discussion.labels && fixture.discussion.labels.length > 0) {
          await addLabelsToDiscussion(
            octokit,
            owner,
            repo,
            discussion.id,
            fixture.discussion.labels,
          );
        }

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
    const { data: labelData } = await parseIssue(owner, repo, issueNumber, {
      octokit: asOctokitLike(octokit),
      fetchPRs: false,
      fetchParent: false,
    });

    const actualLabels = labelData.issue.labels;

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
      const issueComments = await listComments(
        owner,
        repo,
        issueNumber,
        asOctokitLike(octokit),
        { perPage: 100 },
      );

      if (issueComments.length < fixture.expected.min_comments) {
        errors.push({
          field: "min_comments",
          expected: `>= ${fixture.expected.min_comments}`,
          actual: String(issueComments.length),
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
        const { data: subClosedData } = await parseIssue(
          owner,
          repo,
          subIssue.number,
          {
            octokit: asOctokitLike(octokit),
            fetchPRs: false,
            fetchParent: false,
          },
        );
        if (subClosedData.issue.state !== "CLOSED") {
          errors.push({
            field: `sub_issue_${i + 1}_closed`,
            expected: "closed",
            actual: subClosedData.issue.state.toLowerCase(),
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
        const { data: subTodoData } = await parseIssue(
          owner,
          repo,
          subIssue.number,
          {
            octokit: asOctokitLike(octokit),
            fetchPRs: false,
            fetchParent: false,
          },
        );
        const todos = extractTodosFromAst(subTodoData.issue.bodyAst);
        if (todos.uncheckedNonManual > 0) {
          errors.push({
            field: `sub_issue_${i + 1}_todos`,
            expected: "all checked",
            actual: `${todos.uncheckedNonManual} unchecked`,
          });
        }
      }
    }
  }

  // Check iteration history has expected log entries
  if (fixture.expected.history_contains) {
    const { data: historyData } = await parseIssue(owner, repo, issueNumber, {
      octokit: asOctokitLike(octokit),
      fetchPRs: false,
      fetchParent: false,
    });
    const bodyJson = JSON.stringify(historyData.issue.bodyAst);
    for (const pattern of fixture.expected.history_contains) {
      if (!bodyJson.includes(pattern)) {
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
 * Force cancel any running workflow runs related to an issue
 *
 * This finds workflow runs that mention the issue number in their name
 * or display_title and force cancels them. Uses the force-cancel API
 * endpoint which immediately stops runs without waiting for cleanup.
 */
async function forceCancelRelatedWorkflows(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  core.info(`Checking for running workflows related to issue #${issueNumber}`);

  try {
    // List recent workflow runs that are in progress or queued
    const { data: runs } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      status: "in_progress",
      per_page: 50,
    });

    // Also get queued runs
    const { data: queuedRuns } =
      await octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        status: "queued",
        per_page: 50,
      });

    const allRuns = [...runs.workflow_runs, ...queuedRuns.workflow_runs];

    // Get current run ID to avoid cancelling ourselves
    const currentRunId = github.context.runId;

    for (const run of allRuns) {
      // Skip the current run - don't cancel ourselves!
      if (run.id === currentRunId) {
        core.debug(`Skipping current run ${run.id}`);
        continue;
      }

      // Check if run is related to this issue (by name or title containing issue number)
      const runName = run.name || "";
      const displayTitle = run.display_title || "";
      const issuePattern = `#${issueNumber}`;

      const isRelated =
        runName.includes(issuePattern) ||
        displayTitle.includes(issuePattern) ||
        // Also check if run_id matches (for e2e tests)
        displayTitle.includes(`[TEST]`) ||
        // Check head_branch for claude/issue/{N} pattern
        run.head_branch?.includes(`issue/${issueNumber}`) ||
        run.head_branch?.includes(`issue-${issueNumber}`);

      if (isRelated) {
        core.info(
          `Force cancelling workflow run ${run.id}: ${run.name} - ${run.display_title}`,
        );

        try {
          // Use force-cancel endpoint for immediate cancellation
          await octokit.request(
            "POST /repos/{owner}/{repo}/actions/runs/{run_id}/force-cancel",
            {
              owner,
              repo,
              run_id: run.id,
            },
          );
          core.info(`✅ Force cancelled run ${run.id}`);
        } catch (cancelError) {
          // Ignore errors - run may already be cancelled or completed
          core.debug(`Could not force cancel run ${run.id}: ${cancelError}`);
        }
      }
    }
  } catch (error) {
    // Don't fail cleanup if we can't cancel workflows
    core.warning(`Failed to check/cancel related workflows: ${error}`);
  }
}

// ============================================================================
// Cleanup Types and Utilities
// ============================================================================

type CleanupMode = "close" | "delete";

interface CleanupResult {
  success: boolean;
  cleaned: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Delete a branch, ignoring 404 (already deleted)
 */
async function deleteBranch(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    core.info(`Deleted branch: ${branch}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 404
    ) {
      core.info(`Branch already deleted: ${branch}`);
      return;
    }
    throw error;
  }
}

/**
 * Close an issue if it's open, ignoring 404/410 (already deleted)
 */
async function closeIssue(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  try {
    const { data: closeData, update: closeUpdate } = await parseIssue(
      owner,
      repo,
      issueNumber,
      { octokit: asOctokitLike(octokit), fetchPRs: false, fetchParent: false },
    );
    if (closeData.issue.state === "OPEN") {
      const closedState = {
        ...closeData,
        issue: {
          ...closeData.issue,
          state: "CLOSED" as const,
          stateReason: "completed" as const,
        },
      };
      await closeUpdate(closedState);
      core.info(`Closed issue #${issueNumber}`);
    } else {
      core.info(`Issue #${issueNumber} already closed`);
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      (error.status === 404 || error.status === 410)
    ) {
      core.info(`Issue #${issueNumber} already gone`);
      return;
    }
    throw error;
  }
}

/**
 * Cleanup all resources for a test issue using parseIssue from @more/issue-state.
 *
 * Derives the full resource chain (parent -> sub-issues -> PRs -> branches) from
 * parseIssue and deletes everything deterministically.
 *
 * SAFETY: Only cleans up issues whose title starts with [TEST].
 */
async function cleanupFromParseIssue(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    success: true,
    cleaned: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  core.info(
    `Cleaning up test resources for issue #${issueNumber} via parseIssue`,
  );

  // Fetch full relationship chain
  const { data } = await parseIssue(owner, repo, issueNumber, {
    octokit: asOctokitLike(octokit),
    projectNumber,
    fetchPRs: true,
    fetchParent: false, // We ARE the parent
  });

  // Safety: verify title starts with [TEST]
  if (!data.issue.title.startsWith("[TEST]")) {
    throw new Error(
      `SAFETY: Issue #${issueNumber} title "${data.issue.title}" doesn't start with [TEST]. ` +
        `Only test issues can be cleaned up to prevent accidentally deleting real issues.`,
    );
  }

  core.info(
    `Safety check passed: Issue #${issueNumber} title starts with [TEST]`,
  );

  // Render cleanup summary
  const summaryLines: string[] = [
    `## Cleanup Summary`,
    "",
    `### Parent: #${data.issue.number} - ${data.issue.title}`,
    `- Sub-issues: ${data.issue.subIssues.length}`,
    `- PR: ${data.issue.pr ? `#${data.issue.pr.number} (${data.issue.pr.state})` : "none"}`,
    `- Branch: ${data.issue.branch || "none"}`,
    "",
  ];

  if (data.issue.subIssues.length > 0) {
    summaryLines.push("### Sub-Issues");
    for (const sub of data.issue.subIssues) {
      summaryLines.push(
        `- #${sub.number}: ${sub.title} | PR: ${sub.pr ? `#${sub.pr.number}` : "none"} | Branch: ${sub.branch || "none"}`,
      );
    }
    summaryLines.push("");
  }

  await core.summary.addRaw(summaryLines.join("\n")).write();

  // Cancel related workflow runs
  await forceCancelRelatedWorkflows(octokit, owner, repo, issueNumber);

  // Walk sub-issues: close PRs -> delete branches -> close sub-issues
  for (const sub of data.issue.subIssues) {
    try {
      // Close PR if open
      if (sub.pr && sub.pr.state === "OPEN") {
        await octokit.rest.pulls.update({
          owner,
          repo,
          pull_number: sub.pr.number,
          state: "closed",
        });
        core.info(`Closed PR #${sub.pr.number} for sub-issue #${sub.number}`);
        result.cleaned++;
      }

      // Delete branch
      if (sub.branch) {
        await deleteBranch(octokit, owner, repo, sub.branch);
        result.cleaned++;
      }

      // Close sub-issue
      await closeIssue(octokit, owner, repo, sub.number);
      result.cleaned++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      core.warning(`Failed to clean sub-issue #${sub.number}: ${msg}`);
      result.failed++;
      result.errors.push(`Sub-issue #${sub.number}: ${msg}`);
      result.success = false;
    }
  }

  // Close parent PR -> delete parent branch -> close parent issue
  try {
    if (data.issue.pr && data.issue.pr.state === "OPEN") {
      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: data.issue.pr.number,
        state: "closed",
      });
      core.info(`Closed parent PR #${data.issue.pr.number}`);
      result.cleaned++;
    }

    if (data.issue.branch) {
      await deleteBranch(octokit, owner, repo, data.issue.branch);
      result.cleaned++;
    }

    await closeIssue(octokit, owner, repo, issueNumber);
    result.cleaned++;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to clean parent issue #${issueNumber}: ${msg}`);
    result.failed++;
    result.errors.push(`Parent issue #${issueNumber}: ${msg}`);
    result.success = false;
  }

  core.info(
    `Cleanup result: cleaned=${result.cleaned}, failed=${result.failed}`,
  );

  return result;
}

/**
 * Cleanup a test fixture using parseIssue to derive the full resource chain.
 *
 * SAFETY: Only cleans up issues whose title starts with [TEST].
 *
 * Steps:
 * 1. Fetch full relationship chain via parseIssue
 * 2. Force cancel related workflows
 * 3. Walk sub-issues: close PRs -> delete branches -> close sub-issues
 * 4. Close parent PR -> delete parent branch -> close parent issue
 */
async function cleanupFixture(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
  _mode: CleanupMode = "close",
): Promise<void> {
  const result = await cleanupFromParseIssue(
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
  );

  if (!result.success) {
    const errorMsg =
      `Cleanup had failures: cleaned=${result.cleaned}, failed=${result.failed}. ` +
      `Errors: ${result.errors.join("; ")}`;
    await core.summary
      .addRaw("\n\n## Cleanup Warnings\n\n")
      .addRaw(`${errorMsg}\n`)
      .write();
    core.warning(errorMsg);
  }
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
  const { data: resetData, update: resetUpdate } = await parseIssue(
    owner,
    repo,
    issueNumber,
    { octokit: asOctokitLike(octokit), fetchPRs: false, fetchParent: false },
  );

  if (resetData.issue.state === "CLOSED") {
    core.info(`Re-opening parent issue #${issueNumber}`);
    const reopenedState = {
      ...resetData,
      issue: { ...resetData.issue, state: "OPEN" as const },
    };
    await resetUpdate(reopenedState);
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
      const { data: subResetData, update: subResetUpdate } = await parseIssue(
        owner,
        repo,
        subIssue.number,
        {
          octokit: asOctokitLike(octokit),
          fetchPRs: false,
          fetchParent: false,
        },
      );

      if (subResetData.issue.state === "CLOSED") {
        core.info(`Re-opening sub-issue #${subIssue.number}`);
        const subReopenedState = {
          ...subResetData,
          issue: { ...subResetData.issue, state: "OPEN" as const },
        };
        await subResetUpdate(subReopenedState);
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
 * Delete an issue and all its sub-issues
 *
 * IMPORTANT: This permanently deletes the issues and cannot be undone!
 * Only works for issues with the test:automation label to prevent accidental deletion
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

  // SAFETY CHECK: Verify the issue has the test:automation label
  const { data: deleteCheckData } = await parseIssue(owner, repo, issueNumber, {
    octokit: asOctokitLike(octokit),
    fetchPRs: false,
    fetchParent: false,
  });

  const labels = deleteCheckData.issue.labels;

  if (!labels.includes("test:automation")) {
    throw new Error(
      `SAFETY: Refusing to delete issue #${issueNumber} - it does not have the test:automation label. ` +
        `Labels found: [${labels.join(", ")}]. ` +
        `Only issues with the test:automation label can be deleted to prevent accidentally deleting real issues.`,
    );
  }

  // Get node ID for GraphQL delete mutation
  interface IssueNodeIdResponse {
    repository?: {
      issue?: {
        id: string;
      };
    };
  }

  const nodeIdResponse = await octokit.graphql<IssueNodeIdResponse>(
    `query GetIssueNodeId($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          id
        }
      }
    }`,
    { owner, repo, issueNumber },
  );

  const issueNodeIdForDelete = nodeIdResponse.repository?.issue?.id;
  if (!issueNodeIdForDelete) {
    throw new Error(`Could not get node ID for issue #${issueNumber}`);
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
      { issueId: issueNodeIdForDelete },
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
  // Get issue node ID via GraphQL
  interface IssueIdResponse {
    repository?: {
      issue?: {
        id: string;
      };
    };
  }

  const issueIdResponse = await octokit.graphql<IssueIdResponse>(
    `query GetIssueId($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          id
        }
      }
    }`,
    { owner, repo, issueNumber },
  );

  const issueNodeId = issueIdResponse.repository?.issue?.id;
  if (!issueNodeId) {
    core.warning(`Could not get node ID for issue #${issueNumber}`);
    return;
  }

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

import type { E2EOutcomes } from "./types.js";

/**
 * Create e2e config file content for a branch
 * The config file is committed to the branch and read by CI/Release workflows
 */
function createE2EConfigContent(
  runId: string,
  outcomes: E2EOutcomes,
  iteration: number = 0,
): string {
  const config = {
    run_id: runId,
    iteration,
    outcomes: {
      ci: outcomes.ci || ["success"],
      release: outcomes.release || ["success"],
      review: outcomes.review || ["approved"],
    },
    created_at: new Date().toISOString(),
  };
  return JSON.stringify(config, null, 2);
}

/**
 * Commit the e2e config file to a branch
 * Creates or updates the file at the specified path
 */
async function commitE2EConfigFile(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  branchName: string,
  filePath: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  // Get current branch ref
  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
  });

  // Get the current commit
  const { data: commit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: ref.object.sha,
  });

  // Check if file already exists to get its SHA (for updates)
  let existingFileSha: string | undefined;
  try {
    const { data: existingFile } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branchName,
    });
    if (!Array.isArray(existingFile) && existingFile.type === "file") {
      existingFileSha = existingFile.sha;
    }
  } catch {
    // File doesn't exist, that's fine for creation
  }

  // Create blob for the config file
  const { data: blob } = await octokit.rest.git.createBlob({
    owner,
    repo,
    content: Buffer.from(content).toString("base64"),
    encoding: "base64",
  });

  // Create new tree with the config file
  const { data: tree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: commit.tree.sha,
    tree: [
      {
        path: filePath,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      },
    ],
  });

  // Create the commit
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: tree.sha,
    parents: [ref.object.sha],
  });

  // Update branch ref
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: newCommit.sha,
  });

  core.info(
    `Committed ${existingFileSha ? "updated" : "new"} e2e config to ${branchName}: ${newCommit.sha}`,
  );
}

async function run(): Promise<void> {
  try {
    const action = getRequiredInput("action");
    const token = getRequiredInput("github_token");
    const reviewToken = getOptionalInput("github_review_token") || "";
    const projectNumber = parseInt(
      getOptionalInput("project_number") || "1",
      10,
    );
    const octokit = github.getOctokit(token);
    const reviewOctokit = reviewToken
      ? github.getOctokit(reviewToken)
      : undefined;
    const { owner, repo } = github.context.repo;

    // Set GH_TOKEN for CLI commands
    process.env.GH_TOKEN = token;

    // Validate tokens and warn if same user
    // Note: getAuthenticated() requires 'user' scope which GITHUB_TOKEN doesn't have
    // Only check for actions that need to know the user identity
    if (action === "create" || action === "verify") {
      try {
        const { data: codeUser } = await octokit.rest.users.getAuthenticated();
        core.info(`Code token authenticated as: ${codeUser.login}`);

        if (reviewOctokit) {
          const { data: reviewUser } =
            await reviewOctokit.rest.users.getAuthenticated();
          core.info(`Review token authenticated as: ${reviewUser.login}`);

          if (codeUser.login === reviewUser.login) {
            core.warning(
              `Code and review tokens belong to same user (${codeUser.login}) - PR reviews will fail`,
            );
          }
        }
      } catch (authError) {
        // Token doesn't have 'user' scope - this is fine for GITHUB_TOKEN
        core.debug(`Could not verify token identity: ${authError}`);
      }
    }

    if (action === "create") {
      const fixtureJson = getRequiredInput("fixture_json");
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, casting to known fixture shape
      const fixture = JSON.parse(fixtureJson) as TestFixture;

      core.info(`Creating test fixture: ${fixture.name}`);
      core.info(`Description: ${fixture.description}`);

      const result = await createFixture(
        octokit,
        owner,
        repo,
        fixture,
        projectNumber,
        reviewOctokit,
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
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, casting to known fixture shape
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
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- input value matches CleanupMode union
      const cleanupMode = (getOptionalInput("cleanup_mode") ||
        "close") as CleanupMode;

      await cleanupFixture(
        octokit,
        owner,
        repo,
        issueNumber,
        projectNumber,
        cleanupMode,
      );

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

    if (action === "create_e2e_config" || action === "update_e2e_config") {
      const branchName = getRequiredInput("branch_name");
      const e2eRunId = getRequiredInput("e2e_run_id");
      const e2eOutcomesJson = getOptionalInput("e2e_outcomes");
      const fixtureJson = getOptionalInput("fixture_json");
      const iterationStr = getOptionalInput("iteration") || "0";
      const iteration = parseInt(iterationStr, 10);

      // Get outcomes from input or fixture
      let outcomes: E2EOutcomes = {};
      if (e2eOutcomesJson) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, casting to known E2EOutcomes shape
        outcomes = JSON.parse(e2eOutcomesJson) as E2EOutcomes;
      } else if (fixtureJson) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, casting to known fixture shape
        const fixture = JSON.parse(fixtureJson) as TestFixture;
        outcomes = fixture.e2e_outcomes || {};
      }

      // Default outcomes if none specified
      if (!outcomes.ci || outcomes.ci.length === 0) {
        outcomes.ci = ["success"];
      }
      if (!outcomes.release || outcomes.release.length === 0) {
        outcomes.release = ["success"];
      }
      if (!outcomes.review || outcomes.review.length === 0) {
        outcomes.review = ["approved"];
      }

      core.info(
        `${action === "create_e2e_config" ? "Creating" : "Updating"} e2e config with run_id=${e2eRunId}, iteration=${iteration}`,
      );
      core.info(`Outcomes: ${JSON.stringify(outcomes)}`);

      // Create the config file content
      const configContent = createE2EConfigContent(
        e2eRunId,
        outcomes,
        iteration,
      );
      const configPath = ".github/e2e-test-config.json";

      // Commit the config file to the branch
      await commitE2EConfigFile(
        octokit,
        owner,
        repo,
        branchName,
        configPath,
        configContent,
        action === "create_e2e_config"
          ? "chore: add e2e test config"
          : `chore: update e2e config for iteration ${iteration}`,
      );

      setOutputs({
        success: "true",
        config_path: configPath,
      });
      return;
    }

    if (action === "sweep") {
      const manifestDir = path.resolve(getRequiredInput("manifest_dir"));

      core.info(`Sweeping test resources from manifests in ${manifestDir}`);

      // Read all manifest JSON files
      const parentIssues = new Set<number>();

      if (fs.existsSync(manifestDir)) {
        const files = fs.readdirSync(manifestDir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const content = fs.readFileSync(
              path.join(manifestDir, file),
              "utf-8",
            );
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, validating shape inline
            const parsed = JSON.parse(content) as {
              parentIssue?: unknown;
            };
            if (
              typeof parsed.parentIssue === "number" &&
              parsed.parentIssue > 0
            ) {
              parentIssues.add(parsed.parentIssue);
            } else {
              core.warning(
                `Invalid manifest in ${file}: missing or invalid parentIssue`,
              );
            }
          } catch (err) {
            core.warning(`Failed to read manifest ${file}: ${err}`);
          }
        }
      }

      core.info(
        `Found ${parentIssues.size} unique parent issues to sweep: ${[...parentIssues].join(", ")}`,
      );

      let totalCleaned = 0;
      let totalFailed = 0;
      const sweepErrors: string[] = [];

      for (const issueNum of parentIssues) {
        try {
          const result = await cleanupFromParseIssue(
            octokit,
            owner,
            repo,
            issueNum,
            projectNumber,
          );
          totalCleaned += result.cleaned;
          totalFailed += result.failed;
          sweepErrors.push(...result.errors);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          core.warning(`Sweep failed for issue #${issueNum}: ${msg}`);
          sweepErrors.push(`Issue #${issueNum}: ${msg}`);
          totalFailed++;
        }
      }

      await core.summary
        .addRaw(
          `## Sweep Summary\n\nIssues processed: ${parentIssues.size} | Resources cleaned: ${totalCleaned} | Failed: ${totalFailed}\n`,
        )
        .write();

      setOutputs({
        success: String(totalFailed === 0),
        delete_count: String(totalCleaned),
      });

      if (totalFailed > 0) {
        core.warning(
          `Sweep completed with ${totalFailed} failures: ${sweepErrors.join("; ")}`,
        );
      }
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
