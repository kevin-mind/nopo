import * as core from "@actions/core";
import * as fs from "node:fs";
import type { ApplyIterateOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { appendAgentNotes } from "../../parser/index.js";

// ============================================================================
// Iterate Output Types
// ============================================================================

/**
 * Structured output from the iterate prompt
 */
interface IterateOutput {
  status: "completed_todo" | "waiting_manual" | "blocked" | "all_done";
  todos_completed?: string[];
  todo_completed?: string; // Legacy: single todo (backwards compatibility)
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
    iterateOutput = structuredOutput as IterateOutput;
    core.info("Using structured output from in-process chain");
  } else if (filePath && fs.existsSync(filePath)) {
    // Read from file (artifact passed between workflow matrix jobs)
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      iterateOutput = JSON.parse(content) as IterateOutput;
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

  // Fetch current issue body once for both operations
  const issue = await ctx.octokit.rest.issues.get({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
  });

  let body = issue.data.body || "";
  let bodyChanged = false;

  // Check off completed todos in issue body
  if (iterateOutput.status === "completed_todo") {
    // Support both array (new) and single string (legacy)
    const todosToCheck: string[] = [];
    if (iterateOutput.todos_completed && iterateOutput.todos_completed.length > 0) {
      todosToCheck.push(...iterateOutput.todos_completed);
    } else if (iterateOutput.todo_completed) {
      // Legacy: single todo as string
      todosToCheck.push(iterateOutput.todo_completed);
    }

    for (const todoText of todosToCheck) {
      const result = checkOffTodoInBody(body, todoText);
      if (result.found) {
        body = result.body;
        bodyChanged = true;
        core.info(`Completed todo: ${todoText}`);
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

    body = appendAgentNotes(body, {
      runId,
      runLink,
      notes: iterateOutput.agent_notes,
    });
    bodyChanged = true;

    core.info("Agent notes appended to issue body:");
    for (const note of iterateOutput.agent_notes) {
      core.info(`  - ${note}`);
    }
  }

  // Update the issue body if changed
  if (bodyChanged) {
    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
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
      break;
  }

  return { applied: true, status: iterateOutput.status };
}

/**
 * Check off a todo item in a body string
 *
 * Finds the unchecked todo matching the text and checks it off.
 * Uses fuzzy matching to handle slight differences in formatting.
 *
 * @param body - The issue body
 * @param todoText - The todo text to check off
 * @returns Object with updated body and whether a match was found
 */
function checkOffTodoInBody(
  body: string,
  todoText: string,
): { body: string; found: boolean } {
  // Normalize whitespace for matching
  const normalizedTodoText = todoText.trim().toLowerCase();

  // Split body into lines and find the matching todo
  const lines = body.split("\n");
  let found = false;
  const updatedLines = lines.map((line) => {
    // Check if this is an unchecked todo
    const uncheckedMatch = line.match(/^(\s*)-\s*\[\s*\]\s*(.+)$/);
    if (uncheckedMatch) {
      const [, indent, text] = uncheckedMatch;
      const normalizedLineText = (text ?? "").trim().toLowerCase();

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
  }

  return { body: updatedLines.join("\n"), found };
}
