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
  "issue-iterate": "iterating on issue",
  "issue-comment": "responding to comment",
  "push-to-draft": "converting PR to draft",
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

    // Note: We no longer create separate failure issues for each failure.
    // Failures are tracked in the iteration history, and the circuit breaker
    // posts a summary comment when max retries is reached.

    setOutputs({
      failure_issue_number: "",
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
