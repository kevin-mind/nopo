import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getOptionalInput,
  getRequiredInput,
  setOutputs,
} from "../lib/index.js";

type ResourceType = "issue" | "pr" | "discussion";

const JOB_DESCRIPTIONS: Record<string, string> = {
  "issue-triage": "triaging issue",
  "issue-implement": "implementing issue",
  "issue-comment": "responding to comment",
  "push-to-draft": "converting PR to draft",
  "ci-fix": "fixing CI",
  "ci-suggest": "suggesting CI fixes",
  "ci-success": "marking PR ready",
  "pr-review": "reviewing PR",
  "pr-response": "responding to review",
  "pr-human-response": "addressing review",
  "discussion-research": "researching topic",
  "discussion-respond": "responding to question",
  "discussion-summarize": "summarizing discussion",
  "discussion-plan": "creating plan",
  "discussion-complete": "completing discussion",
};

async function addReactionToComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  commentId: string,
  resourceType: ResourceType,
  reaction: "rocket" | "thumbs_down",
): Promise<void> {
  try {
    if (resourceType === "discussion") {
      const graphqlReaction = reaction === "rocket" ? "ROCKET" : "THUMBS_DOWN";
      await octokit.graphql(
        `
        mutation($subjectId: ID!) {
          addReaction(input: {
            subjectId: $subjectId
            content: ${graphqlReaction}
          }) {
            reaction { id }
          }
        }
      `,
        { subjectId: commentId },
      );
    } else {
      await octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: parseInt(commentId, 10),
        content: reaction === "rocket" ? "rocket" : "-1",
      });
    }
    core.info(`Added ${reaction} reaction to comment ${commentId}`);
  } catch (error) {
    core.warning(`Failed to add reaction to comment: ${error}`);
  }
}

async function updateStatusComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  resourceType: ResourceType,
  statusCommentId: string,
  job: string,
  success: boolean,
  runUrl: string,
): Promise<void> {
  const description = JOB_DESCRIPTIONS[job] ?? job;
  const emoji = success ? "✅" : "❌";
  const status = success ? "completed successfully" : "failed";

  const body = `${emoji} **nopo-bot** ${description} ${status}.

[View workflow run](${runUrl})`;

  try {
    if (resourceType === "discussion") {
      await octokit.graphql(
        `
        mutation($commentId: ID!, $body: String!) {
          updateDiscussionComment(input: {
            commentId: $commentId
            body: $body
          }) {
            comment { id }
          }
        }
      `,
        { commentId: statusCommentId, body },
      );
    } else {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: parseInt(statusCommentId, 10),
        body,
      });
    }
    core.info(`Updated status comment ${statusCommentId}`);
  } catch (error) {
    core.warning(`Failed to update status comment: ${error}`);
  }
}

async function createFailureIssue(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  resourceType: ResourceType,
  resourceNumber: string,
  job: string,
  runUrl: string,
  contextJson: string,
): Promise<string> {
  const description = JOB_DESCRIPTIONS[job] ?? job;
  const resourceLabel =
    resourceType === "discussion"
      ? "Discussion"
      : resourceType === "pr"
        ? "PR"
        : "Issue";
  const title = `[Claude Failure] ${description} for ${resourceLabel} #${resourceNumber}`;

  // Check for existing open failure issue with the same title
  const { data: existingIssues } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: "claude-failure",
    state: "open",
    per_page: 100,
  });

  const existingIssue = existingIssues.find((issue) => issue.title === title);
  if (existingIssue) {
    // Add a comment to the existing issue instead of creating a new one
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: existingIssue.number,
      body: `## Additional Failure

**Workflow Run**: ${runUrl}

Another failure occurred for this job. Check the workflow run for details.`,
    });
    core.info(
      `Added comment to existing failure issue #${existingIssue.number}`,
    );
    return String(existingIssue.number);
  }

  let contextSection = "";
  if (contextJson && contextJson !== "{}") {
    try {
      const context = JSON.parse(contextJson);
      const contextLines = Object.entries(context)
        .map(
          ([key, value]) =>
            `- **${key}**: ${String(value).substring(0, 200)}${String(value).length > 200 ? "..." : ""}`,
        )
        .join("\n");
      contextSection = `

## Context
${contextLines}`;
    } catch {
      // Ignore JSON parse errors
    }
  }

  const body = `## Claude Automation Failure

**Job**: ${job}
**${resourceLabel}**: #${resourceNumber}
**Workflow Run**: ${runUrl}
${contextSection}

## Description

Claude failed while ${description}. Please investigate the workflow run logs for details.

## Next Steps

1. Check the [workflow run](${runUrl}) for error details
2. Fix the underlying issue
3. Re-trigger the automation if needed

---
*This issue was automatically created by Claude automation.*`;

  const { data: issue } = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels: ["claude-failure", "bug"],
  });

  core.info(`Created failure issue #${issue.number}`);
  return String(issue.number);
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput("github_token");
    const resourceType = getRequiredInput("resource_type") as ResourceType;
    const resourceNumber = getRequiredInput("resource_number");
    const statusCommentId = getRequiredInput("status_comment_id");
    const commentId = getOptionalInput("comment_id");
    const job = getRequiredInput("job");
    const jobResult = getRequiredInput("job_result");
    const runUrl = getRequiredInput("run_url");
    const contextJson = getOptionalInput("context_json") ?? "{}";

    const octokit = github.getOctokit(token);
    const { context } = github;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    const success = jobResult === "success";

    core.info(`Handling result for ${resourceType} #${resourceNumber}`);
    core.info(`Job: ${job}, Result: ${jobResult}`);

    // Update status comment
    await updateStatusComment(
      octokit,
      owner,
      repo,
      resourceType,
      statusCommentId,
      job,
      success,
      runUrl,
    );

    // Add reaction to status comment
    await addReactionToComment(
      octokit,
      owner,
      repo,
      statusCommentId,
      resourceType,
      success ? "rocket" : "thumbs_down",
    );

    // Add reaction to triggering comment if provided
    if (commentId) {
      await addReactionToComment(
        octokit,
        owner,
        repo,
        commentId,
        resourceType,
        success ? "rocket" : "thumbs_down",
      );
    }

    let failureIssueNumber = "";

    // Create failure issue if job failed
    if (!success && jobResult !== "skipped" && jobResult !== "cancelled") {
      failureIssueNumber = await createFailureIssue(
        octokit,
        owner,
        repo,
        resourceType,
        resourceNumber,
        job,
        runUrl,
        contextJson,
      );
    }

    setOutputs({
      failure_issue_number: failureIssueNumber,
    });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
