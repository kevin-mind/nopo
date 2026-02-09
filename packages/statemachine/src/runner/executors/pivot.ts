/**
 * Pivot Executor
 *
 * Applies pivot output from Claude's structured analysis.
 * TODO: Full implementation to be migrated from .github/statemachine
 */

import * as core from "@actions/core";
import * as fs from "fs";
import { ADD_SUB_ISSUE_MUTATION } from "@more/issue-state";
import type { ApplyPivotOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";

// ============================================================================
// Types (matches @more/prompts Pivot output schema)
// ============================================================================

interface TodoModification {
  action: "add" | "modify" | "remove";
  index: number;
  text?: string;
}

interface SubIssueModification {
  issue_number: number;
  action: "modify" | "skip";
  todo_modifications?: TodoModification[];
  update_description?: string;
}

interface NewSubIssue {
  title: string;
  description: string;
  todos: string[];
  reason: "reversion" | "new_scope" | "extension";
}

interface PivotOutput {
  analysis: {
    change_summary: string;
    affects_completed_work: boolean;
    completed_work_details?: Array<{
      type: "checked_todo" | "closed_sub_issue";
      issue_number: number;
      description: string;
    }>;
  };
  modifications?: {
    parent_issue?: {
      update_sections?: Record<string, string>;
    };
    sub_issues?: SubIssueModification[];
    new_sub_issues?: NewSubIssue[];
  };
  outcome: "changes_applied" | "needs_clarification" | "no_changes_needed";
  clarification_needed?: string;
  summary_for_user: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Upsert a section in a markdown body
 * Simple version - inserts or updates a ## section
 */
function upsertSectionInBody(
  body: string,
  sectionName: string,
  content: string,
): string {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(## ${escapedName}\\s*\\n)[\\s\\S]*?(?=\\n## |\\n<!-- |$)`,
    "i",
  );

  if (pattern.test(body)) {
    // Section exists - replace it
    return body.replace(pattern, `$1\n${content}\n`).trim();
  } else {
    // Section doesn't exist - append it
    return `${body.trim()}\n\n## ${sectionName}\n\n${content}`;
  }
}

/**
 * Apply todo modifications to an issue body
 *
 * Modifications are applied in order with index recalculation after each operation:
 * - add: inserts a new unchecked todo after the specified index (-1 for prepend)
 * - modify: changes the text of an unchecked todo at the index
 * - remove: deletes an unchecked todo at the index
 *
 * Safety: This function refuses to modify checked todos ([x])
 */
function applyTodoModifications(
  body: string,
  modifications: TodoModification[],
): string {
  const lines = body.split("\n");

  // Build array of todo line indices and their content
  interface TodoEntry {
    lineIndex: number;
    checked: boolean;
    text: string;
  }

  const todos: TodoEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^- \[([ x])\] (.*)$/);
    if (match) {
      todos.push({
        lineIndex: i,
        checked: match[1] === "x",
        text: match[2] || "",
      });
    }
  }

  // Apply modifications in order
  for (const mod of modifications) {
    const todoIndex = mod.index;

    if (mod.action === "add") {
      // Add inserts AFTER the specified index (-1 means prepend)
      const insertLineIndex =
        todoIndex < 0
          ? todos.length > 0
            ? todos[0]!.lineIndex
            : lines.length
          : todoIndex < todos.length
            ? todos[todoIndex]!.lineIndex + 1
            : lines.length;

      const newLine = `- [ ] ${mod.text || ""}`;
      lines.splice(insertLineIndex, 0, newLine);

      // Recalculate todos
      todos.length = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const match = line.match(/^- \[([ x])\] (.*)$/);
        if (match) {
          todos.push({
            lineIndex: i,
            checked: match[1] === "x",
            text: match[2] || "",
          });
        }
      }
    } else if (mod.action === "modify") {
      if (todoIndex < 0 || todoIndex >= todos.length) {
        core.warning(`Cannot modify todo at index ${todoIndex}: out of bounds`);
        continue;
      }

      const todo = todos[todoIndex]!;
      if (todo.checked) {
        core.warning(
          `Cannot modify checked todo at index ${todoIndex}: safety constraint`,
        );
        continue;
      }

      lines[todo.lineIndex] = `- [ ] ${mod.text || ""}`;
      todo.text = mod.text || "";
    } else if (mod.action === "remove") {
      if (todoIndex < 0 || todoIndex >= todos.length) {
        core.warning(`Cannot remove todo at index ${todoIndex}: out of bounds`);
        continue;
      }

      const todo = todos[todoIndex]!;
      if (todo.checked) {
        core.warning(
          `Cannot remove checked todo at index ${todoIndex}: safety constraint`,
        );
        continue;
      }

      lines.splice(todo.lineIndex, 1);

      // Recalculate todos
      todos.length = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const match = line.match(/^- \[([ x])\] (.*)$/);
        if (match) {
          todos.push({
            lineIndex: i,
            checked: match[1] === "x",
            text: match[2] || "",
          });
        }
      }
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Apply Pivot Output
// ============================================================================

/**
 * Apply pivot output from Claude's structured analysis
 *
 * Validates safety constraints and applies changes to issue specifications:
 * - Cannot modify checked todos ([x] items are immutable)
 * - Cannot modify closed sub-issues
 * - For completed work changes, creates NEW sub-issues (reversion/extension)
 *
 * After applying changes, posts a summary comment explaining what changed.
 * This is a terminal action - user must review and /lfg to continue.
 *
 * TODO: Full implementation with safety validations
 */
export async function executeApplyPivotOutput(
  action: ApplyPivotOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; changesApplied: number }> {
  let pivotOutput: PivotOutput;

  // Try structured output first, then fall back to file
  if (structuredOutput) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- structured output from Claude SDK is typed as unknown
    pivotOutput = structuredOutput as PivotOutput;
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, file content matches PivotOutput schema
    pivotOutput = JSON.parse(content) as PivotOutput;
    core.info(`Pivot output from file: ${action.filePath}`);
  } else {
    throw new Error(
      `No structured output provided and file not found at: ${action.filePath}`,
    );
  }

  core.info(`Applying pivot output for issue #${action.issueNumber}`);
  core.startGroup("Pivot Output");
  core.info(JSON.stringify(pivotOutput, null, 2));
  core.endGroup();

  // Handle different outcomes
  if (pivotOutput.outcome === "needs_clarification") {
    core.info("Pivot needs clarification - posting comment and exiting");
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: action.issueNumber,
      body: `## Pivot Needs Clarification\n\n${pivotOutput.clarification_needed || pivotOutput.summary_for_user}\n\n*Please provide more details and try again.*`,
    });
    return { applied: false, changesApplied: 0 };
  }

  if (pivotOutput.outcome === "no_changes_needed") {
    core.info("No changes needed");
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: action.issueNumber,
      body: `## Pivot Analysis\n\n${pivotOutput.summary_for_user}\n\n*No changes were required.*`,
    });
    return { applied: true, changesApplied: 0 };
  }

  // Count changes
  let changesApplied = 0;
  const mods = pivotOutput.modifications;

  if (mods?.parent_issue?.update_sections) {
    changesApplied += Object.keys(mods.parent_issue.update_sections).length;
  }

  if (mods?.sub_issues) {
    for (const subIssue of mods.sub_issues) {
      if (subIssue.action === "modify" && subIssue.todo_modifications) {
        changesApplied += subIssue.todo_modifications.length;
      }
      if (subIssue.update_description) {
        changesApplied++;
      }
    }
  }

  const newSubIssueCount = mods?.new_sub_issues?.length ?? 0;
  changesApplied += newSubIssueCount;

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply ${changesApplied} pivot changes`);
    return { applied: true, changesApplied };
  }

  // Apply parent issue section updates
  if (mods?.parent_issue?.update_sections) {
    const { data: parentIssue } = await ctx.octokit.rest.issues.get({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: action.issueNumber,
    });

    let updatedBody = parentIssue.body || "";

    for (const [section, content] of Object.entries(
      mods.parent_issue.update_sections,
    )) {
      core.info(`Updating parent issue section "${section}"`);
      updatedBody = upsertSectionInBody(updatedBody, section, content);
    }

    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: action.issueNumber,
      body: updatedBody,
    });
    core.info(`Updated parent issue body`);
  }

  // Apply sub-issue modifications
  if (mods?.sub_issues) {
    for (const subIssue of mods.sub_issues) {
      if (subIssue.action === "skip") continue;

      core.info(`Modifying sub-issue #${subIssue.issue_number}`);

      // Fetch sub-issue body
      const { data: issueData } = await ctx.octokit.rest.issues.get({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: subIssue.issue_number,
      });

      let updatedBody = issueData.body || "";

      // Apply todo modifications
      if (
        subIssue.todo_modifications &&
        subIssue.todo_modifications.length > 0
      ) {
        updatedBody = applyTodoModifications(
          updatedBody,
          subIssue.todo_modifications,
        );
      }

      // Apply description update
      if (subIssue.update_description) {
        updatedBody = subIssue.update_description;
      }

      // Update the sub-issue
      await ctx.octokit.rest.issues.update({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: subIssue.issue_number,
        body: updatedBody,
      });

      core.info(`Updated sub-issue #${subIssue.issue_number}`);
    }
  }

  // Create new sub-issues
  if (mods?.new_sub_issues && mods.new_sub_issues.length > 0) {
    core.info(`Creating ${mods.new_sub_issues.length} new sub-issues`);

    for (const newSubIssue of mods.new_sub_issues) {
      // Build body with todos
      const todoList = newSubIssue.todos.map((t) => `- [ ] ${t}`).join("\n");
      const body = `${newSubIssue.description}\n\n## Todo\n\n${todoList}`;

      const { data: createdIssue } = await ctx.octokit.rest.issues.create({
        owner: ctx.owner,
        repo: ctx.repo,
        title: newSubIssue.title,
        body,
      });

      core.info(
        `Created sub-issue #${createdIssue.number}: ${newSubIssue.title} (${newSubIssue.reason})`,
      );

      // Link to parent using GraphQL
      try {
        const { data: parentIssue } = await ctx.octokit.rest.issues.get({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: action.issueNumber,
        });

        await ctx.octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
          parentId: parentIssue.node_id,
          childId: createdIssue.node_id,
        });
        core.info(`Linked sub-issue #${createdIssue.number} to parent`);
      } catch (error) {
        core.warning(`Failed to link sub-issue via GraphQL: ${error}`);
      }
    }
  }

  // Post summary comment
  await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    body: `## Pivot Applied\n\n${pivotOutput.summary_for_user}\n\n*${changesApplied} changes applied. Review and use \`/lfg\` to continue.*`,
  });

  core.info(`Applied ${changesApplied} pivot changes`);
  return { applied: true, changesApplied };
}
