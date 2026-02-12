/**
 * Iterate Executor
 *
 * Processes Claude's structured output from iterate actions.
 */

import * as core from "@actions/core";
import * as fs from "node:fs";
import type {
  ApplyIterateOutputAction,
  MarkPRReadyAction,
  RequestReviewAction,
  UpdateProjectStatusAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { checkOffTodo, appendAgentNotes } from "../../parser/index.js";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import {
  IterateOutputSchema,
  parseOutput,
  type IterateOutput,
} from "./output-schemas.js";
import { executeMarkPRReady, executeRequestReview } from "./github.js";
import { executeUpdateProjectStatus } from "./project.js";

// Helper to cast RunnerContext octokit to OctokitLike

function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
}

// ============================================================================
// Apply Iterate Output
// ============================================================================

/**
 * Execute applyIterateOutput action
 *
 * Processes Claude's structured output from an iterate action:
 * - Checks off completed todos in the issue body
 * - Appends agent notes to the "## Agent Notes" section in issue body
 */
export async function executeApplyIterateOutput(
  action: ApplyIterateOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; status?: string }> {
  const { issueNumber, filePath } = action;

  let iterateOutput: IterateOutput;

  // Try structured output first (in-process chaining), then fall back to file
  if (structuredOutput) {
    iterateOutput = parseOutput(
      IterateOutputSchema,
      structuredOutput,
      "iterate",
    );
    core.info("Using structured output from in-process chain");
  } else if (filePath && fs.existsSync(filePath)) {
    // Read from file (artifact passed between workflow matrix jobs)
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      iterateOutput = parseOutput(
        IterateOutputSchema,
        JSON.parse(content),
        "iterate file",
      );
      core.info(`Iterate output from file: ${filePath}`);
    } catch (error) {
      core.warning(`Failed to parse iterate output: ${error}`);
      return { applied: false };
    }
  } else {
    core.warning(
      `No structured output provided and iterate output file not found at: ${filePath || "undefined"}. ` +
        "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
    );
    return { applied: false };
  }

  core.info(`Processing iterate output for issue #${issueNumber}`);
  core.startGroup("Iterate Output");
  core.info(JSON.stringify(iterateOutput, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply iterate output to issue #${issueNumber}`);
    return { applied: true, status: iterateOutput.status };
  }

  // Fetch current issue state via parseIssue
  const { data, update } = await parseIssue(ctx.owner, ctx.repo, issueNumber, {
    octokit: asOctokitLike(ctx),
    fetchPRs: false,
    fetchParent: false,
  });

  let state = data;

  // Check off completed todos in issue body
  if (
    iterateOutput.status === "completed_todo" ||
    iterateOutput.status === "all_done"
  ) {
    // Support both array (new) and single string (legacy)
    const todosToCheck: string[] = [];
    if (
      iterateOutput.todos_completed &&
      iterateOutput.todos_completed.length > 0
    ) {
      todosToCheck.push(...iterateOutput.todos_completed);
    } else if (iterateOutput.todo_completed) {
      // Legacy: single todo as string
      todosToCheck.push(iterateOutput.todo_completed);
    }

    for (const todoText of todosToCheck) {
      const newState = checkOffTodo({ todoText }, state);
      if (newState !== state) {
        state = newState;
        core.info(`Completed todo: ${todoText}`);
      } else {
        core.warning(`Could not find unchecked todo matching: "${todoText}"`);
      }
    }
  }

  // Append agent notes to the issue body
  if (iterateOutput.agent_notes.length > 0) {
    // Extract run ID from the run URL (last path segment)
    const runId = ctx.runUrl?.split("/").pop() || `run-${Date.now()}`;
    const runLink =
      ctx.runUrl ||
      `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

    state = appendAgentNotes(
      { runId, runLink, notes: iterateOutput.agent_notes },
      state,
    );

    core.info("Agent notes appended to issue body:");
    for (const note of iterateOutput.agent_notes) {
      core.info(`  - ${note}`);
    }
  }

  // Persist if changed
  if (state !== data) {
    await update(state);
  }

  // Log status info
  switch (iterateOutput.status) {
    case "completed_todo":
      // Already logged above
      break;
    case "waiting_manual":
      core.info(`Waiting for manual todo: ${iterateOutput.manual_todo}`);
      break;
    case "blocked":
      core.warning(`Iteration blocked: ${iterateOutput.blocked_reason}`);
      break;
    case "all_done":
      core.info("All todos complete - ready for review");
      // Transition to review: mark PR ready, update project status, request review
      if (action.prNumber) {
        try {
          // Mark PR as ready for review (convert from draft)
          const markReadyAction: MarkPRReadyAction = {
            type: "markPRReady",
            token: "code",
            prNumber: action.prNumber,
          };
          await executeMarkPRReady(markReadyAction, ctx);

          // Update project status to Review
          const updateStatusAction: UpdateProjectStatusAction = {
            type: "updateProjectStatus",
            token: "code",
            issueNumber,
            status: "In review",
          };
          await executeUpdateProjectStatus(updateStatusAction, ctx);

          // Request review
          if (action.reviewer) {
            const requestReviewAction: RequestReviewAction = {
              type: "requestReview",
              token: "code",
              prNumber: action.prNumber,
              reviewer: action.reviewer,
            };
            await executeRequestReview(requestReviewAction, ctx);
          }
          core.info(`Review transition complete for PR #${action.prNumber}`);
        } catch (error) {
          core.warning(`Failed to transition to review: ${error}`);
        }
      } else {
        core.warning(
          "No PR number available - cannot transition to review automatically",
        );
      }
      break;
  }

  return { applied: true, status: iterateOutput.status };
}
