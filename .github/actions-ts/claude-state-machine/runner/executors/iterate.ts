import * as core from "@actions/core";
import type { ApplyIterateOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// Iterate Output Types
// ============================================================================

/**
 * Structured output from the iterate prompt
 */
interface IterateOutput {
  status: "completed_todo" | "waiting_manual" | "blocked" | "all_done";
  todo_completed?: string;
  manual_todo?: string;
  blocked_reason?: string;
  agent_notes: string[];
}

// ============================================================================
// Apply Iterate Output
// ============================================================================

/**
 * Execute applyIterateOutput action
 *
 * Processes Claude's structured output from an iterate action:
 * - Checks off completed todos in the issue body
 * - Stores agent notes in issue history
 */
export async function executeApplyIterateOutput(
  action: ApplyIterateOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; status?: string }> {
  const { issueNumber } = action;

  if (!structuredOutput) {
    core.warning("No structured output provided for applyIterateOutput");
    return { applied: false };
  }

  const iterateOutput = structuredOutput as IterateOutput;

  core.info(`Processing iterate output for issue #${issueNumber}`);
  core.startGroup("Iterate Output");
  core.info(JSON.stringify(iterateOutput, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply iterate output to issue #${issueNumber}`);
    return { applied: true, status: iterateOutput.status };
  }

  // Check off completed todo in issue body
  if (
    iterateOutput.status === "completed_todo" &&
    iterateOutput.todo_completed
  ) {
    await checkOffTodo(ctx, issueNumber, iterateOutput.todo_completed);
  }

  // Log important status info
  switch (iterateOutput.status) {
    case "completed_todo":
      core.info(`Completed todo: ${iterateOutput.todo_completed}`);
      break;
    case "waiting_manual":
      core.info(`Waiting for manual todo: ${iterateOutput.manual_todo}`);
      break;
    case "blocked":
      core.warning(`Iteration blocked: ${iterateOutput.blocked_reason}`);
      break;
    case "all_done":
      core.info("All todos complete - ready for review");
      break;
  }

  // Log agent notes
  if (iterateOutput.agent_notes.length > 0) {
    core.info("Agent notes for future iterations:");
    for (const note of iterateOutput.agent_notes) {
      core.info(`  - ${note}`);
    }
  }

  return { applied: true, status: iterateOutput.status };
}

/**
 * Check off a todo item in the issue body
 *
 * Finds the unchecked todo matching the text and checks it off.
 * Uses fuzzy matching to handle slight differences in formatting.
 */
async function checkOffTodo(
  ctx: RunnerContext,
  issueNumber: number,
  todoText: string,
): Promise<boolean> {
  // Fetch current issue body
  const issue = await ctx.octokit.rest.issues.get({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
  });

  const body = issue.data.body || "";

  // Find and check off the todo
  // Pattern: - [ ] <todo text>
  // We normalize whitespace for matching
  const normalizedTodoText = todoText.trim().toLowerCase();

  // Split body into lines and find the matching todo
  const lines = body.split("\n");
  let found = false;
  const updatedLines = lines.map((line) => {
    // Check if this is an unchecked todo
    const uncheckedMatch = line.match(/^(\s*)-\s*\[\s*\]\s*(.+)$/);
    if (uncheckedMatch) {
      const [, indent, text] = uncheckedMatch;
      const normalizedLineText = text.trim().toLowerCase();

      // Check for match (exact or fuzzy)
      if (
        normalizedLineText === normalizedTodoText ||
        normalizedLineText.includes(normalizedTodoText) ||
        normalizedTodoText.includes(normalizedLineText)
      ) {
        found = true;
        return `${indent}- [x] ${text}`;
      }
    }
    return line;
  });

  if (!found) {
    core.warning(`Could not find unchecked todo matching: "${todoText}"`);
    return false;
  }

  // Update the issue body
  const updatedBody = updatedLines.join("\n");
  await ctx.octokit.rest.issues.update({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
    body: updatedBody,
  });

  core.info(`Checked off todo: "${todoText}"`);
  return true;
}
