/**
 * Agent Notes Executor
 *
 * Appends agent notes to the issue body.
 */

import * as core from "@actions/core";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import type { AppendAgentNotesAction } from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { appendAgentNotes } from "../../parser/index.js";

function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
}

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

  // Use parseIssue + mutator + update pattern
  const { data, update } = await parseIssue(ctx.owner, ctx.repo, issueNumber, {
    octokit: asOctokitLike(ctx),
    fetchPRs: false,
    fetchParent: false,
  });

  const state = appendAgentNotes({ runId, runLink, timestamp, notes }, data);

  if (state !== data) {
    await update(state);
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
