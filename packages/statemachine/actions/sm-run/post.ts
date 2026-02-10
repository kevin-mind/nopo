/**
 * Post-cancellation cleanup for sm-run action.
 *
 * Runs when GitHub cancels the workflow job. Updates the "⏳ running..."
 * history entry to "🚫 Cancelled" so it doesn't stay stuck.
 *
 * State is passed from the main action via core.saveState/getState.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import { updateHistoryEntry } from "@more/statemachine";

async function post(): Promise<void> {
  // Only run on cancellation
  // When post-if is set to cancelled(), this should always be true,
  // but guard defensively in case action.yml changes.
  const issueNumberStr = core.getState("issue_number");
  if (!issueNumberStr) {
    core.info("No issue state saved — skipping cancellation cleanup");
    return;
  }

  const dryRun = core.getState("dry_run") === "true";
  if (dryRun) {
    core.info("[DRY RUN] Would update history entry to cancelled");
    return;
  }

  const issueNumber = parseInt(issueNumberStr, 10);
  const iteration = parseInt(core.getState("iteration") || "0", 10);
  const phase = core.getState("phase") || "-";
  const transitionName = core.getState("transition_name") || "unknown";

  const codeToken = core.getInput("github_code_token");
  if (!codeToken) {
    core.warning("No github_code_token available for cancellation cleanup");
    return;
  }

  const octokit = github.getOctokit(codeToken);
  const { owner, repo } = github.context.repo;

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID || "";
  const runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
  const repoUrl = `${serverUrl}/${owner}/${repo}`;

  const newMessage = `🚫 Cancelled (${transitionName})`;

  try {
    const { data, update } = await parseIssue(owner, repo, issueNumber, {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
      octokit: octokit as unknown as OctokitLike,
      fetchPRs: false,
      fetchParent: false,
    });

    const state = updateHistoryEntry(
      {
        matchIteration: iteration,
        matchPhase: phase,
        matchPattern: "\u23f3 running...",
        newAction: newMessage,
        timestamp: new Date().toISOString(),
        runLink: runUrl,
        repoUrl,
      },
      data,
    );

    if (state === data) {
      core.info("No matching running history entry found — nothing to update");
      return;
    }

    await update(state);
    core.info(`Updated history entry to cancelled for issue #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to update history on cancellation: ${error}`);
  }
}

post();
