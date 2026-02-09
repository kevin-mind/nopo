import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "@more/statemachine";
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

// Query to get PRs linked to an issue via "Fixes #<number>" or similar
const GET_ISSUE_LINKED_PRS_QUERY = `
query GetIssueLinkedPRs($org: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $org, name: $repo) {
    issue(number: $issueNumber) {
      id
      number
      timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent {
            source {
              ... on PullRequest {
                number
                title
                state
                headRefName
                url
              }
            }
          }
          ... on ConnectedEvent {
            subject {
              ... on PullRequest {
                number
                title
                state
                headRefName
                url
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
        labels: ["test:automation", "triaged"],
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
                `Set sub-issue #${subIssue.number} Status to ${subStatus}`,
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
              `Set sub-issue #${subIssue.number} Iteration to ${subConfig.project_fields.Iteration}`,
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
              `Set sub-issue #${subIssue.number} Failures to ${subConfig.project_fields.Failures}`,
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
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pr.number,
      labels: ["test:automation"],
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

interface ResourceSnapshot {
  parentIssue: {
    number: number;
    title: string;
    state: string;
    labels: string[];
    url: string;
  };
  subIssues: Array<{
    number: number;
    title: string;
    state: string;
    url: string;
  }>;
  pullRequests: Array<{
    number: number;
    title: string;
    state: string;
    branch: string;
    url: string;
  }>;
  branches: Array<{
    name: string;
    ref: string;
  }>;
  workflowRuns: Array<{
    id: number;
    name: string;
    status: string;
    url: string;
  }>;
}

type CleanupNodeType =
  | "workflow"
  | "pr"
  | "branch"
  | "sub-issue"
  | "parent-issue";

interface CleanupNode {
  type: CleanupNodeType;
  id: string;
  displayName: string;
  status: "pending" | "cleaning" | "verified" | "failed";
  error?: string;
}

interface CleanupResult {
  success: boolean;
  cleaned: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Retry an operation with linear backoff and jitter
 *
 * @param operation - The async operation to retry
 * @param verify - Function to verify the operation succeeded
 * @param options - Retry configuration
 * @returns The result of the operation
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  verify: () => Promise<boolean>,
  options: {
    maxRetries: number;
    baseDelayMs: number;
    maxJitterMs: number;
    operationName: string;
  },
): Promise<{ success: boolean; result?: T; error?: string }> {
  const { maxRetries, baseDelayMs, maxJitterMs, operationName } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      // Verify the operation succeeded
      const verified = await verify();
      if (verified) {
        core.info(`✓ ${operationName} succeeded on attempt ${attempt}`);
        return { success: true, result };
      }

      core.warning(
        `${operationName} completed but verification failed (attempt ${attempt}/${maxRetries})`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      core.warning(
        `${operationName} failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`,
      );
    }

    if (attempt < maxRetries) {
      // Linear backoff with jitter: delay = (attempt * baseDelay) + random(0, maxJitter)
      const jitter = Math.floor(Math.random() * maxJitterMs);
      const delay = attempt * baseDelayMs + jitter;
      core.info(`Waiting ${delay}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    error: `${operationName} failed after ${maxRetries} attempts`,
  };
}

/**
 * Take a snapshot of all resources related to an issue for the workflow summary
 */
async function snapshotResources(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<ResourceSnapshot> {
  // Get parent issue
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const labels = issue.labels.map((l) =>
    typeof l === "string" ? l : l.name || "",
  );

  // Get sub-issues
  interface SubIssuesResponse {
    repository?: {
      issue?: {
        subIssues?: {
          nodes?: Array<{
            number?: number;
            title?: string;
            state?: string;
            url?: string;
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

  const subIssueNodes = subResponse.repository?.issue?.subIssues?.nodes || [];

  // Get full details for each sub-issue
  const subIssues: ResourceSnapshot["subIssues"] = [];
  for (const sub of subIssueNodes) {
    if (sub.number) {
      const { data: subData } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: sub.number,
      });
      subIssues.push({
        number: subData.number,
        title: subData.title,
        state: subData.state,
        url: subData.html_url,
      });
    }
  }

  // Get linked PRs for parent and all sub-issues using GitHub's timeline API
  // This finds PRs that have "Fixes #<issue>" linking
  const relatedPRs: ResourceSnapshot["pullRequests"] = [];
  const branches: ResourceSnapshot["branches"] = [];
  const allIssueNumbers = [issueNumber, ...subIssues.map((s) => s.number)];

  interface LinkedPRsResponse {
    repository?: {
      issue?: {
        timelineItems?: {
          nodes?: Array<{
            source?: {
              number?: number;
              title?: string;
              state?: string;
              headRefName?: string;
              url?: string;
            };
            subject?: {
              number?: number;
              title?: string;
              state?: string;
              headRefName?: string;
              url?: string;
            };
          }>;
        };
      };
    };
  }

  for (const issueNum of allIssueNumbers) {
    try {
      const response = await octokit.graphql<LinkedPRsResponse>(
        GET_ISSUE_LINKED_PRS_QUERY,
        { org: owner, repo, issueNumber: issueNum },
      );

      const timelineNodes =
        response.repository?.issue?.timelineItems?.nodes || [];

      for (const node of timelineNodes) {
        // Handle both CrossReferencedEvent (source) and ConnectedEvent (subject)
        const pr = node.source || node.subject;
        if (pr?.number && pr?.headRefName) {
          // Avoid duplicates
          if (!relatedPRs.some((p) => p.number === pr.number)) {
            relatedPRs.push({
              number: pr.number,
              title: pr.title || "",
              state: pr.state?.toLowerCase() || "open",
              branch: pr.headRefName,
              url: pr.url || "",
            });

            // Add branch from PR (branches come from PRs, not searched separately)
            if (!branches.some((b) => b.name === pr.headRefName)) {
              branches.push({
                name: pr.headRefName,
                ref: `refs/heads/${pr.headRefName}`,
              });
            }
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      core.debug(`Failed to get linked PRs for issue #${issueNum}: ${msg}`);
    }
  }

  // Get running workflow runs
  const workflowRuns: ResourceSnapshot["workflowRuns"] = [];
  try {
    const { data: runs } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      status: "in_progress",
      per_page: 50,
    });

    const { data: queuedRuns } =
      await octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        status: "queued",
        per_page: 50,
      });

    const allRuns = [...runs.workflow_runs, ...queuedRuns.workflow_runs];
    const issuePattern = `#${issueNumber}`;
    const currentRunId = github.context.runId;

    for (const run of allRuns) {
      // Skip the current run - don't include ourselves in cleanup!
      if (run.id === currentRunId) {
        continue;
      }

      const runName = run.name || "";
      const displayTitle = run.display_title || "";

      const isRelated =
        runName.includes(issuePattern) ||
        displayTitle.includes(issuePattern) ||
        displayTitle.includes(`[TEST]`) ||
        run.head_branch?.includes(`issue/${issueNumber}`) ||
        run.head_branch?.includes(`issue-${issueNumber}`);

      if (isRelated) {
        workflowRuns.push({
          id: run.id,
          name: `${runName} - ${displayTitle}`,
          status: run.status || "unknown",
          url: run.html_url,
        });
      }
    }
  } catch {
    // Ignore errors listing workflows
  }

  return {
    parentIssue: {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels,
      url: issue.html_url,
    },
    subIssues,
    pullRequests: relatedPRs,
    branches,
    workflowRuns,
  };
}

/**
 * Render the resource snapshot as markdown for the workflow summary
 */
function renderSnapshotMarkdown(
  snapshot: ResourceSnapshot,
  mode: CleanupMode,
): string {
  const lines: string[] = [];

  lines.push(`## Cleanup Summary (mode: ${mode})`);
  lines.push("");
  lines.push("### Resources to Clean");
  lines.push("");

  // Parent Issue
  lines.push("#### Parent Issue");
  lines.push(`| # | Title | State | Labels |`);
  lines.push(`|---|-------|-------|--------|`);
  lines.push(
    `| [#${snapshot.parentIssue.number}](${snapshot.parentIssue.url}) | ${snapshot.parentIssue.title} | ${snapshot.parentIssue.state} | ${snapshot.parentIssue.labels.join(", ")} |`,
  );
  lines.push("");

  // Sub-Issues
  if (snapshot.subIssues.length > 0) {
    lines.push("#### Sub-Issues");
    lines.push(`| # | Title | State |`);
    lines.push(`|---|-------|-------|`);
    for (const sub of snapshot.subIssues) {
      lines.push(
        `| [#${sub.number}](${sub.url}) | ${sub.title} | ${sub.state} |`,
      );
    }
    lines.push("");
  }

  // Pull Requests
  if (snapshot.pullRequests.length > 0) {
    lines.push("#### Pull Requests");
    lines.push(`| # | Title | State | Branch |`);
    lines.push(`|---|-------|-------|--------|`);
    for (const pr of snapshot.pullRequests) {
      lines.push(
        `| [#${pr.number}](${pr.url}) | ${pr.title} | ${pr.state} | \`${pr.branch}\` |`,
      );
    }
    lines.push("");
  }

  // Branches
  if (snapshot.branches.length > 0) {
    lines.push("#### Branches");
    lines.push(`| Name |`);
    lines.push(`|------|`);
    for (const branch of snapshot.branches) {
      lines.push(`| \`${branch.name}\` |`);
    }
    lines.push("");
  }

  // Workflow Runs
  if (snapshot.workflowRuns.length > 0) {
    lines.push("#### Active Workflow Runs");
    lines.push(`| ID | Name | Status |`);
    lines.push(`|---|------|--------|`);
    for (const run of snapshot.workflowRuns) {
      lines.push(`| [${run.id}](${run.url}) | ${run.name} | ${run.status} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Graph-based cleanup with deterministic retry
 *
 * Traverses resources from leaves to root:
 * Workflows (parallel) -> PRs -> Branches -> Sub-Issues -> Parent Issue
 */
class CleanupGraph {
  private octokit: ReturnType<typeof github.getOctokit>;
  private owner: string;
  private repo: string;
  private mode: CleanupMode;
  private projectNumber: number;
  private nodes: CleanupNode[] = [];
  private snapshot: ResourceSnapshot;

  // Retry configuration
  private readonly MAX_NODE_RETRIES = 10;
  private readonly BASE_DELAY_MS = 2000;
  private readonly MAX_JITTER_MS = 1000;

  constructor(
    octokit: ReturnType<typeof github.getOctokit>,
    owner: string,
    repo: string,
    mode: CleanupMode,
    projectNumber: number,
    snapshot: ResourceSnapshot,
  ) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
    this.mode = mode;
    this.projectNumber = projectNumber;
    this.snapshot = snapshot;
  }

  /**
   * Set the project Status field to "Done" for an issue
   */
  private async setProjectStatusDone(issueNumber: number): Promise<void> {
    try {
      // Get project item and field info from the issue's linked project
      interface ProjectFieldNode {
        id?: string;
        name?: string;
        options?: Array<{ id: string; name: string }>;
      }

      interface ProjectItemNode {
        id?: string;
        project?: {
          id?: string;
          number?: number;
          fields?: {
            nodes?: ProjectFieldNode[];
          };
        };
      }

      interface ProjectQueryResponse {
        repository?: {
          issue?: {
            projectItems?: {
              nodes?: ProjectItemNode[];
            };
          };
        };
      }

      // Query project item and get project fields from the linked project directly
      const response = await this.octokit.graphql<ProjectQueryResponse>(
        `query GetProjectInfo($org: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $org, name: $repo) {
            issue(number: $issueNumber) {
              projectItems(first: 10) {
                nodes {
                  id
                  project {
                    id
                    number
                    fields(first: 20) {
                      nodes {
                        ... on ProjectV2SingleSelectField {
                          id
                          name
                          options { id name }
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
          org: this.owner,
          repo: this.repo,
          issueNumber,
        },
      );

      // Find the project item for this project
      const projectItem = response.repository?.issue?.projectItems?.nodes?.find(
        (item) => item.project?.number === this.projectNumber,
      );

      if (!projectItem?.id) {
        core.warning(
          `Issue #${issueNumber} not found in project ${this.projectNumber}`,
        );
        return;
      }

      // Get project ID from the project item
      const projectId = projectItem.project?.id;
      if (!projectId) {
        core.warning(`Project ${this.projectNumber} not found`);
        return;
      }

      // Find Status field and Done option from the project item's project
      const statusField = projectItem.project?.fields?.nodes?.find(
        (f) => f.name === "Status",
      );

      if (!statusField?.id || !statusField.options) {
        core.warning(`Status field not found in project ${this.projectNumber}`);
        return;
      }

      const doneOption = statusField.options.find((o) => o.name === "Done");
      if (!doneOption) {
        core.warning(`"Done" option not found in Status field`);
        return;
      }

      // Update the status
      await this.octokit.graphql(
        `mutation UpdateStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }) {
            projectV2Item { id }
          }
        }`,
        {
          projectId,
          itemId: projectItem.id,
          fieldId: statusField.id,
          optionId: doneOption.id,
        },
      );

      core.info(`Set issue #${issueNumber} project status to Done`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      core.warning(
        `Failed to set project status for issue #${issueNumber}: ${errorMsg}`,
      );
    }
  }

  /**
   * Build the cleanup graph from the snapshot
   */
  buildGraph(): void {
    this.nodes = [];

    // Add workflow nodes (can be cleaned in parallel, no dependencies)
    for (const run of this.snapshot.workflowRuns) {
      this.nodes.push({
        type: "workflow",
        id: String(run.id),
        displayName: `Workflow ${run.id}`,
        status: "pending",
      });
    }

    // Add PR nodes (must be cleaned before branches)
    for (const pr of this.snapshot.pullRequests) {
      if (pr.state === "open") {
        this.nodes.push({
          type: "pr",
          id: String(pr.number),
          displayName: `PR #${pr.number}`,
          status: "pending",
        });
      }
    }

    // Add branch nodes (must be cleaned after PRs)
    for (const branch of this.snapshot.branches) {
      this.nodes.push({
        type: "branch",
        id: branch.name,
        displayName: `Branch ${branch.name}`,
        status: "pending",
      });
    }

    // Add sub-issue nodes (must be cleaned before parent)
    // Always add - we need to ensure they're closed AND status is Done
    for (const sub of this.snapshot.subIssues) {
      this.nodes.push({
        type: "sub-issue",
        id: String(sub.number),
        displayName: `Sub-issue #${sub.number}`,
        status: "pending",
      });
    }

    // Add parent issue node (cleaned last)
    // Always add - we need to ensure it's closed AND status is Done
    this.nodes.push({
      type: "parent-issue",
      id: String(this.snapshot.parentIssue.number),
      displayName: `Parent issue #${this.snapshot.parentIssue.number}`,
      status: "pending",
    });

    core.info(`Built cleanup graph with ${this.nodes.length} nodes`);
  }

  /**
   * Get nodes of a specific type that are still pending
   */
  private getPendingByType(type: CleanupNodeType): CleanupNode[] {
    return this.nodes.filter((n) => n.type === type && n.status === "pending");
  }

  /**
   * Check if all nodes of given types are verified
   */
  private allVerified(types: CleanupNodeType[]): boolean {
    return this.nodes
      .filter((n) => types.includes(n.type))
      .every((n) => n.status === "verified" || n.status === "failed");
  }

  /**
   * Clean a single node with retry
   */
  private async cleanNode(node: CleanupNode): Promise<boolean> {
    node.status = "cleaning";

    const result = await retryWithBackoff(
      () => this.executeCleanup(node),
      () => this.verifyCleanup(node),
      {
        maxRetries: this.MAX_NODE_RETRIES,
        baseDelayMs: this.BASE_DELAY_MS,
        maxJitterMs: this.MAX_JITTER_MS,
        operationName: node.displayName,
      },
    );

    if (result.success) {
      node.status = "verified";
      return true;
    } else {
      node.status = "failed";
      node.error = result.error;
      return false;
    }
  }

  /**
   * Execute the cleanup action for a node
   */
  private async executeCleanup(node: CleanupNode): Promise<void> {
    switch (node.type) {
      case "workflow": {
        const runId = parseInt(node.id, 10);
        // Check if workflow is already completed/cancelled before attempting to cancel
        const { data: run } = await this.octokit.rest.actions.getWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId,
        });
        if (run.status === "completed" || run.status === "cancelled") {
          core.debug(
            `Workflow ${runId} already ${run.status}, skipping cancel`,
          );
          break;
        }
        await this.octokit.rest.actions.cancelWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId,
        });
        break;
      }

      case "pr": {
        const prNumber = parseInt(node.id, 10);
        await this.octokit.rest.pulls.update({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          state: "closed",
        });
        break;
      }

      case "branch": {
        await this.octokit.rest.git.deleteRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${node.id}`,
        });
        break;
      }

      case "sub-issue":
      case "parent-issue": {
        const issueNumber = parseInt(node.id, 10);
        if (this.mode === "delete") {
          // Get issue node ID for deletion
          const { data: issue } = await this.octokit.rest.issues.get({
            owner: this.owner,
            repo: this.repo,
            issue_number: issueNumber,
          });
          await this.octokit.graphql(
            `mutation DeleteIssue($issueId: ID!) {
              deleteIssue(input: { issueId: $issueId }) {
                clientMutationId
              }
            }`,
            { issueId: issue.node_id },
          );
        } else {
          // Close if open
          const { data: issue } = await this.octokit.rest.issues.get({
            owner: this.owner,
            repo: this.repo,
            issue_number: issueNumber,
          });
          if (issue.state === "open") {
            await this.octokit.rest.issues.update({
              owner: this.owner,
              repo: this.repo,
              issue_number: issueNumber,
              state: "closed",
              state_reason: "completed",
            });
          }
          // Always set project status to Done
          await this.setProjectStatusDone(issueNumber);
        }
        break;
      }
    }
  }

  /**
   * Verify the cleanup action succeeded
   */
  private async verifyCleanup(node: CleanupNode): Promise<boolean> {
    try {
      switch (node.type) {
        case "workflow": {
          const runId = parseInt(node.id, 10);
          const { data: run } = await this.octokit.rest.actions.getWorkflowRun({
            owner: this.owner,
            repo: this.repo,
            run_id: runId,
          });
          return run.status === "completed" || run.status === "cancelled";
        }

        case "pr": {
          const prNumber = parseInt(node.id, 10);
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
          });
          return pr.state === "closed";
        }

        case "branch": {
          try {
            await this.octokit.rest.git.getRef({
              owner: this.owner,
              repo: this.repo,
              ref: `heads/${node.id}`,
            });
            return false; // Branch still exists
          } catch (error) {
            // 404 means branch is deleted
            if (
              error &&
              typeof error === "object" &&
              "status" in error &&
              error.status === 404
            ) {
              return true;
            }
            throw error;
          }
        }

        case "sub-issue":
        case "parent-issue": {
          const issueNumber = parseInt(node.id, 10);
          if (this.mode === "delete") {
            try {
              await this.octokit.rest.issues.get({
                owner: this.owner,
                repo: this.repo,
                issue_number: issueNumber,
              });
              return false; // Issue still exists
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                "status" in error &&
                error.status === 404
              ) {
                return true;
              }
              // Issue exists but different error - re-fetch
              return false;
            }
          } else {
            const { data: issue } = await this.octokit.rest.issues.get({
              owner: this.owner,
              repo: this.repo,
              issue_number: issueNumber,
            });
            return issue.state === "closed";
          }
        }

        default:
          return false;
      }
    } catch (error) {
      core.warning(`Verification error for ${node.displayName}: ${error}`);
      return false;
    }
  }

  /**
   * Clean all nodes in dependency order
   *
   * Order: workflows -> PRs -> branches -> sub-issues -> parent-issue
   */
  async cleanAll(): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: true,
      cleaned: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    // Phase 1: Workflows (parallel)
    core.info("Phase 1: Cancelling workflow runs...");
    const workflows = this.getPendingByType("workflow");
    if (workflows.length > 0) {
      await Promise.all(workflows.map((n) => this.cleanNode(n)));
    }

    // Phase 2: PRs (sequential to avoid rate limits)
    core.info("Phase 2: Closing PRs...");
    for (const node of this.getPendingByType("pr")) {
      await this.cleanNode(node);
    }

    // Phase 3: Branches (sequential, after PRs closed)
    core.info("Phase 3: Deleting branches...");
    for (const node of this.getPendingByType("branch")) {
      await this.cleanNode(node);
    }

    // Phase 4: Sub-issues (sequential, before parent)
    core.info("Phase 4: Closing/deleting sub-issues...");
    for (const node of this.getPendingByType("sub-issue")) {
      await this.cleanNode(node);
    }

    // Phase 5: Parent issue (last)
    core.info("Phase 5: Closing/deleting parent issue...");
    for (const node of this.getPendingByType("parent-issue")) {
      await this.cleanNode(node);
    }

    // Tally results
    for (const node of this.nodes) {
      if (node.status === "verified") {
        result.cleaned++;
      } else if (node.status === "failed") {
        result.failed++;
        result.success = false;
        if (node.error) {
          result.errors.push(`${node.displayName}: ${node.error}`);
        }
      } else {
        result.skipped++;
      }
    }

    return result;
  }

  /**
   * Verify all nodes are in expected final state
   */
  async verifyAll(): Promise<boolean> {
    let allGood = true;
    for (const node of this.nodes) {
      if (node.status === "verified") {
        const stillVerified = await this.verifyCleanup(node);
        if (!stillVerified) {
          core.warning(`${node.displayName} reverted to unclean state`);
          node.status = "pending";
          allGood = false;
        }
      }
    }
    return allGood;
  }
}

/**
 * Cleanup a test fixture with graph-based traversal and deterministic retry
 *
 * SAFETY: Only cleans up issues that have the `test:automation` label to prevent
 * accidentally closing real issues.
 *
 * Steps:
 * 1. Take snapshot and render to workflow summary
 * 2. Build dependency graph
 * 3. Clean graph with per-node retry (10x with backoff+jitter)
 * 4. Top-level retry of entire graph (3x)
 * 5. Fail if cleanup unsuccessful after all retries
 */
async function cleanupFixture(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
  mode: CleanupMode = "close",
): Promise<void> {
  const MAX_TREE_RETRIES = 3;

  core.info(
    `Cleaning up test fixture for issue #${issueNumber} (mode: ${mode})`,
  );

  // SAFETY CHECK: Verify the issue has the test:automation label before proceeding
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const labels = issue.labels.map((l) =>
    typeof l === "string" ? l : l.name || "",
  );

  if (!labels.includes("test:automation")) {
    throw new Error(
      `SAFETY: Refusing to cleanup issue #${issueNumber} - it does not have the test:automation label. ` +
        `Labels found: [${labels.join(", ")}]. ` +
        `Only issues with the test:automation label can be cleaned up to prevent accidentally closing real issues.`,
    );
  }

  core.info(
    `Safety check passed: Issue #${issueNumber} has test:automation label`,
  );

  // Step 1: Take snapshot (once, before any cleanup)
  core.info("Step 1: Taking resource snapshot...");
  const snapshot = await snapshotResources(octokit, owner, repo, issueNumber);

  // Render snapshot to workflow summary
  const summaryMarkdown = renderSnapshotMarkdown(snapshot, mode);
  await core.summary.addRaw(summaryMarkdown).write();
  core.info("Resource snapshot written to workflow summary");

  // Step 2: Force cancel any running workflow runs first (before graph)
  core.info("Step 2: Force-cancelling related workflows...");
  await forceCancelRelatedWorkflows(octokit, owner, repo, issueNumber);

  // Step 3: Build and run cleanup graph with top-level retry
  core.info("Step 3: Building cleanup graph...");

  let lastResult: CleanupResult | null = null;

  for (let treeAttempt = 1; treeAttempt <= MAX_TREE_RETRIES; treeAttempt++) {
    core.info(
      `\n=== Tree cleanup attempt ${treeAttempt}/${MAX_TREE_RETRIES} ===`,
    );

    // Re-snapshot to pick up any state changes
    const currentSnapshot =
      treeAttempt === 1
        ? snapshot
        : await snapshotResources(octokit, owner, repo, issueNumber);

    const graph = new CleanupGraph(
      octokit,
      owner,
      repo,
      mode,
      projectNumber,
      currentSnapshot,
    );
    graph.buildGraph();

    lastResult = await graph.cleanAll();

    core.info(
      `Tree attempt ${treeAttempt} result: cleaned=${lastResult.cleaned}, failed=${lastResult.failed}, skipped=${lastResult.skipped}`,
    );

    if (lastResult.success) {
      // Final verification
      const verified = await graph.verifyAll();
      if (verified) {
        core.info("✓ Cleanup complete and verified");
        return;
      }
      core.warning("Cleanup completed but final verification failed");
    }

    if (treeAttempt < MAX_TREE_RETRIES) {
      // Wait before tree-level retry (longer delay)
      const treeDelay = treeAttempt * 5000 + Math.floor(Math.random() * 2000);
      core.info(`Waiting ${treeDelay}ms before tree-level retry...`);
      await new Promise((resolve) => setTimeout(resolve, treeDelay));
    }
  }

  // All retries exhausted
  const errorMsg =
    `Cleanup failed after ${MAX_TREE_RETRIES} tree-level retries. ` +
    `Errors: ${lastResult?.errors.join("; ") || "unknown"}`;

  // Add failure summary
  await core.summary
    .addRaw("\n\n## ❌ Cleanup Failed\n\n")
    .addRaw(`${errorMsg}\n`)
    .write();

  throw new Error(errorMsg);
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
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const labels = issue.labels.map((l) =>
    typeof l === "string" ? l : l.name || "",
  );

  if (!labels.includes("test:automation")) {
    throw new Error(
      `SAFETY: Refusing to delete issue #${issueNumber} - it does not have the test:automation label. ` +
        `Labels found: [${labels.join(", ")}]. ` +
        `Only issues with the test:automation label can be deleted to prevent accidentally deleting real issues.`,
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
