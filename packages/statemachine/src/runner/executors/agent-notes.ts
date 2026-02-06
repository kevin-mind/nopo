/**
 * Agent Notes Executor
 *
 * Appends agent notes to the issue body.
 */

import * as core from "@actions/core";
import type { AppendAgentNotesAction } from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { appendAgentNotes } from "../../parser/index.js";

/**
 * Execute appendAgentNotes action
 *
 * Appends agent notes to the "## Agent Notes" section in the issue body.
 * Creates the section if it doesn't exist.
 *
 * @param action - The action containing notes to append
 * @param ctx - Runner context with octokit and repo info
 * @returns Result indicating whether notes were appended
 */
export async function executeAppendAgentNotes(
  action: AppendAgentNotesAction,
  ctx: RunnerContext,
): Promise<{ appended: boolean }> {
  const { issueNumber, notes, runId, runLink, timestamp } = action;

  // Skip if no notes to append
  if (notes.length === 0) {
    core.info("No agent notes to append, skipping");
    return { appended: false };
  }

  core.info(`Appending ${notes.length} agent notes to issue #${issueNumber}`);

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would append agent notes to issue #${issueNumber}`);
    core.startGroup("Agent Notes (dry run)");
    for (const note of notes) {
      core.info(`  - ${note}`);
    }
    core.endGroup();
    return { appended: true };
  }

  // Fetch current issue body
  const issue = await ctx.octokit.rest.issues.get({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
  });

  const currentBody = issue.data.body || "";

  // Append the new notes entry
  const updatedBody = appendAgentNotes(currentBody, {
    runId,
    runLink,
    timestamp,
    notes,
  });

  // Update the issue if body changed
  if (updatedBody !== currentBody) {
    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body: updatedBody,
    });

    core.info(`Appended ${notes.length} agent notes to issue #${issueNumber}`);
    core.startGroup("Agent Notes");
    for (const note of notes) {
      core.info(`  - ${note}`);
    }
    core.endGroup();
  } else {
    core.info("Issue body unchanged (notes may be empty)");
  }

  return { appended: true };
}
