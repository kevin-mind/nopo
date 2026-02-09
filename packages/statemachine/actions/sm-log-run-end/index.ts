/**
 * Log Run End Action
 *
 * Determines workflow outcome and updates the history entry.
 * Consolidates the outcome determination and link type logic that was
 * previously inline bash in the workflow.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import {
  // Action utilities
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  determineOutcome,
  type JobResult,
  // MDAST mutators
  updateHistoryEntry,
  addHistoryEntry,
} from "@more/statemachine";

// Helper to cast octokit
function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
  return octokit as unknown as OctokitLike;
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- input value matches JobResult union
    const deriveResult = getRequiredInput("derive_result") as JobResult;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- input value matches JobResult union
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

    // Fetch current issue state via parseIssue
    const { data, update } = await parseIssue(owner, repo, issueNumber, {
      octokit: asOctokitLike(octokit),
      fetchPRs: false,
      fetchParent: false,
    });

    const parentNumber = data.issue.parentIssueNumber;

    // Format the new message
    const newMessage = `${outcome.emoji} ${outcome.transition}`;

    // Update the history entry
    let state = updateHistoryEntry(
      {
        matchIteration: iteration,
        matchPhase: phase,
        matchPattern: "\u23f3 running...",
        newAction: newMessage,
        timestamp: new Date().toISOString(),
        sha: outcome.commitSha || undefined,
        runLink: runUrl,
        repoUrl,
      },
      data,
    );

    if (state === data) {
      // No matching entry found - add a new entry instead
      core.info(
        `No matching history entry found - adding new entry for Phase ${phase}`,
      );
      state = addHistoryEntry(
        {
          iteration,
          phase,
          action: newMessage,
          timestamp: new Date().toISOString(),
          sha: outcome.commitSha || undefined,
          runLink: runUrl,
          repoUrl,
        },
        state,
      );
    }

    await update(state);
    core.info(`Updated history entry for issue #${issueNumber}`);

    // Also update parent if this is a sub-issue
    if (parentNumber) {
      const { data: parentData, update: parentUpdate } = await parseIssue(
        owner,
        repo,
        parentNumber,
        {
          octokit: asOctokitLike(octokit),
          fetchPRs: false,
          fetchParent: false,
        },
      );

      let parentState = updateHistoryEntry(
        {
          matchIteration: iteration,
          matchPhase: phase,
          matchPattern: "\u23f3 running...",
          newAction: newMessage,
          timestamp: new Date().toISOString(),
          sha: outcome.commitSha || undefined,
          runLink: runUrl,
          repoUrl,
        },
        parentData,
      );

      if (parentState === parentData) {
        parentState = addHistoryEntry(
          {
            iteration,
            phase,
            action: newMessage,
            timestamp: new Date().toISOString(),
            sha: outcome.commitSha || undefined,
            runLink: runUrl,
            repoUrl,
          },
          parentState,
        );
      }

      await parentUpdate(parentState);
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
