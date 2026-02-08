/**
 * Log Run End Action
 *
 * Determines workflow outcome and updates the history entry.
 * Consolidates the outcome determination and link type logic that was
 * previously inline bash in the workflow.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { GET_ISSUE_BODY_QUERY } from "@more/issue-state";
import {
  // Action utilities
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  determineOutcome,
  type JobResult,
  // Runner utilities
  updateHistoryEntry,
  addHistoryEntry,
} from "@more/statemachine";

interface IssueBodyResponse {
  repository?: {
    issue?: {
      id?: string;
      body?: string;
      parent?: {
        number?: number;
      };
    };
  };
}

// ============================================================================
// Main
// ============================================================================

async function run(): Promise<void> {
  try {
    // Parse inputs
    const token = getRequiredInput("github_token");
    const _projectNumber = parseInt(getRequiredInput("project_number"), 10);
    const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
    const deriveResult = getRequiredInput("derive_result") as JobResult;
    const execResult = getRequiredInput("exec_result") as JobResult;
    const actionCount = parseInt(getRequiredInput("action_count"), 10);
    const transitionName = getRequiredInput("transition_name");
    const iteration = parseInt(getRequiredInput("iteration"), 10);
    const phase = getRequiredInput("phase");
    const subIssueNumberStr = getOptionalInput("sub_issue_number") || "";
    const prNumberStr = getOptionalInput("pr_number") || "";
    const commitSha = getOptionalInput("commit_sha") || "";
    const runUrl = getRequiredInput("run_url");
    const dryRun = getOptionalInput("dry_run") === "true";

    // Parse optional numbers
    const subIssueNumber = subIssueNumberStr
      ? parseInt(subIssueNumberStr, 10)
      : undefined;
    const prNumber = prNumberStr ? parseInt(prNumberStr, 10) : undefined;

    // Get repository info
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const repoUrl = `${github.context.serverUrl}/${owner}/${repo}`;

    core.info(`Log Run End starting...`);
    core.info(`Issue: #${issueNumber}`);
    core.info(`Derive result: ${deriveResult}`);
    core.info(`Exec result: ${execResult}`);
    core.info(`Action count: ${actionCount}`);
    core.info(`Transition: ${transitionName}`);
    core.info(`Dry run: ${dryRun}`);

    // Determine outcome
    const outcome = determineOutcome({
      deriveResult,
      execResult,
      actionCount,
      transitionName,
      phase,
      subIssueNumber,
      prNumber,
      commitSha,
      repoUrl,
    });

    core.info(`Outcome: ${outcome.emoji} ${outcome.status}`);
    core.info(`Formatted transition: ${outcome.transition}`);

    // Set outputs for visibility
    setOutputs({
      emoji: outcome.emoji,
      status: outcome.status,
      transition: outcome.transition,
    });

    if (dryRun) {
      core.info("[DRY RUN] Would update history entry");
      setOutputs({ updated: "false" });
      return;
    }

    // Fetch current issue body
    const response = await octokit.graphql<IssueBodyResponse>(
      GET_ISSUE_BODY_QUERY,
      {
        owner,
        repo,
        issueNumber,
      },
    );

    const currentBody = response.repository?.issue?.body || "";
    const parentNumber = response.repository?.issue?.parent?.number;

    // Format the new message
    const newMessage = `${outcome.emoji} ${outcome.transition}`;

    // Update the history entry
    const result = updateHistoryEntry(
      currentBody,
      iteration,
      phase,
      "⏳ running...",
      newMessage,
      new Date().toISOString(),
      outcome.commitSha || undefined,
      runUrl,
      repoUrl,
      outcome.prNumber || undefined,
    );

    let updatedBody = result.body;

    if (!result.updated) {
      // No matching entry found - add a new entry instead
      core.info(
        `No matching history entry found - adding new entry for Phase ${phase}`,
      );
      updatedBody = addHistoryEntry(
        currentBody,
        iteration,
        phase,
        newMessage,
        new Date().toISOString(),
        outcome.commitSha || undefined,
        runUrl,
        repoUrl,
        outcome.prNumber || undefined,
      );
    }

    // Update the issue
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      body: updatedBody,
    });

    core.info(`Updated history entry for issue #${issueNumber}`);

    // Also update parent if this is a sub-issue
    if (parentNumber) {
      const parentResponse = await octokit.graphql<IssueBodyResponse>(
        GET_ISSUE_BODY_QUERY,
        {
          owner,
          repo,
          issueNumber: parentNumber,
        },
      );

      const parentBody = parentResponse.repository?.issue?.body || "";

      const parentResult = updateHistoryEntry(
        parentBody,
        iteration,
        phase,
        "⏳ running...",
        newMessage,
        new Date().toISOString(),
        outcome.commitSha || undefined,
        runUrl,
        repoUrl,
        outcome.prNumber || undefined,
      );

      let updatedParentBody = parentResult.body;

      if (!parentResult.updated) {
        updatedParentBody = addHistoryEntry(
          parentBody,
          iteration,
          phase,
          newMessage,
          new Date().toISOString(),
          outcome.commitSha || undefined,
          runUrl,
          repoUrl,
          outcome.prNumber || undefined,
        );
      }

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: parentNumber,
        body: updatedParentBody,
      });

      core.info(`Also updated parent issue #${parentNumber}`);
    }

    setOutputs({ updated: "true" });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
