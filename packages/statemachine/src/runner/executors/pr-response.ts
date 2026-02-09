/**
 * PR Response Executor
 *
 * Processes Claude's structured output from PR response actions.
 */

import * as core from "@actions/core";
import * as fs from "node:fs";
import type { ApplyPRResponseOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { appendAgentNotes } from "../../parser/index.js";
import {
  PRResponseOutputSchema,
  parseOutput,
  type PRResponseOutput,
} from "./output-schemas.js";

// ============================================================================
// Apply PR Response Output
// ============================================================================

/**
 * Execute applyPRResponseOutput action
 *
 * Processes Claude's structured output from a PR response action:
 * 1. Posts the summary as a PR comment
 * 2. If had_commits=false, re-requests review from the specified reviewer
 * 3. Appends agent notes to the issue body
 *
 * If had_commits=true, CI will handle the next steps (triggered by the push).
 */
export async function executeApplyPRResponseOutput(
  action: ApplyPRResponseOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; hadCommits: boolean }> {
  let responseOutput: PRResponseOutput;

  // Try structured output first (in-process chaining), then fall back to file
  if (structuredOutput) {
    responseOutput = parseOutput(
      PRResponseOutputSchema,
      structuredOutput,
      "pr-response",
    );
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    // Read from file (artifact passed between workflow matrix jobs)
    try {
      const content = fs.readFileSync(action.filePath, "utf-8");
      responseOutput = parseOutput(
        PRResponseOutputSchema,
        JSON.parse(content),
        "pr-response file",
      );
      core.info(`PR response output from file: ${action.filePath}`);
    } catch (error) {
      throw new Error(`Failed to parse PR response output from file: ${error}`);
    }
  } else {
    throw new Error(
      `No structured output provided and PR response output file not found at: ${action.filePath || "undefined"}. ` +
        "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
    );
  }

  // Validate required fields
  if (
    typeof responseOutput.had_commits !== "boolean" ||
    !responseOutput.summary
  ) {
    throw new Error(
      `Invalid PR response output: missing had_commits or summary. Got: ${JSON.stringify(responseOutput)}`,
    );
  }

  core.info(
    `Applying PR response output: had_commits=${responseOutput.had_commits}`,
  );
  core.startGroup("PR Response Output");
  core.info(JSON.stringify(responseOutput, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would post comment and ${responseOutput.had_commits ? "wait for CI" : "re-request review"} on PR #${action.prNumber}`,
    );
    return { applied: true, hadCommits: responseOutput.had_commits };
  }

  // 1. Post the summary as a PR comment
  await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.prNumber,
    body: responseOutput.summary,
  });

  core.info(`Posted response comment on PR #${action.prNumber}`);

  // 2. If no commits were made, re-request review
  // When had_commits=true, CI will trigger from the push and handle the PR state
  if (!responseOutput.had_commits) {
    try {
      await ctx.octokit.rest.pulls.requestReviewers({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: action.prNumber,
        reviewers: [action.reviewer],
      });

      core.info(
        `Re-requested review from ${action.reviewer} on PR #${action.prNumber}`,
      );
    } catch (error) {
      // Log but don't fail - the comment was posted successfully
      core.warning(`Failed to re-request review: ${error}`);
    }
  }

  // 3. Append agent notes to the issue body
  if (responseOutput.agent_notes && responseOutput.agent_notes.length > 0) {
    const runId = ctx.runUrl?.split("/").pop() || `run-${Date.now()}`;
    const runLink =
      ctx.runUrl ||
      `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

    // Fetch current issue body
    const issue = await ctx.octokit.rest.issues.get({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: action.issueNumber,
    });

    const currentBody = issue.data.body || "";
    const updatedBody = appendAgentNotes(currentBody, {
      runId,
      runLink,
      notes: responseOutput.agent_notes,
    });

    if (updatedBody !== currentBody) {
      await ctx.octokit.rest.issues.update({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: action.issueNumber,
        body: updatedBody,
      });

      core.info(
        `Appended ${responseOutput.agent_notes.length} agent notes to issue #${action.issueNumber}`,
      );
    }
  }

  return { applied: true, hadCommits: responseOutput.had_commits };
}
