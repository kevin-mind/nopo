import * as core from "@actions/core";
import * as fs from "fs";
import type { ApplyPivotOutputAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Completed work that would be affected by the pivot
 */
interface CompletedWorkDetail {
  type: "checked_todo" | "closed_sub_issue";
  issue_number: number;
  description: string;
}

/**
 * Analysis of the pivot request
 */
interface PivotAnalysis {
  change_summary: string;
  affects_completed_work: boolean;
  completed_work_details?: CompletedWorkDetail[];
}

/**
 * Modifications to the parent issue
 * Note: Todos should be added to sub-issues, not the parent issue.
 * Parent issue modifications are for updating sections like Requirements/Description.
 */
interface ParentIssueModifications {
  update_sections?: Record<string, string>;
}

/**
 * Index-based todo modification
 */
interface TodoModification {
  action: "add" | "modify" | "remove";
  index: number;
  text?: string;
}

/**
 * Modifications to a sub-issue
 */
interface SubIssueModification {
  issue_number: number;
  action: "modify" | "skip";
  todo_modifications?: TodoModification[];
  update_description?: string;
}

/**
 * New sub-issue to create
 */
interface NewSubIssue {
  title: string;
  description: string;
  todos: string[];
  reason: "reversion" | "new_scope" | "extension";
}

/**
 * All modifications to apply
 */
interface PivotModifications {
  parent_issue?: ParentIssueModifications;
  sub_issues?: SubIssueModification[];
  new_sub_issues?: NewSubIssue[];
}

/**
 * Full pivot output structure
 */
interface PivotOutput {
  analysis: PivotAnalysis;
  modifications?: PivotModifications;
  outcome: "changes_applied" | "needs_clarification" | "no_changes_needed";
  clarification_needed?: string;
  summary_for_user: string;
}

/**
 * Safety validation result
 */
interface SafetyValidation {
  valid: boolean;
  violations: string[];
}

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute applyPivotOutput action
 *
 * Validates safety constraints and applies changes to issue specifications:
 * - Cannot modify checked todos ([x] items are immutable)
 * - Cannot modify closed sub-issues
 * - For completed work changes, creates NEW sub-issues
 *
 * After applying changes, posts a summary comment explaining what changed.
 */
export async function executeApplyPivotOutput(
  action: ApplyPivotOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; outcome?: string }> {
  const { issueNumber, filePath } = action;

  let pivotOutput: PivotOutput;

  // Try structured output first, then fall back to file
  if (structuredOutput) {
    pivotOutput = structuredOutput as PivotOutput;
    core.info("Using structured output from in-process chain");
    core.startGroup("Pivot Output (Structured)");
    core.info(JSON.stringify(pivotOutput, null, 2));
    core.endGroup();
  } else if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      pivotOutput = JSON.parse(content) as PivotOutput;
      core.info(`Pivot output from file: ${filePath}`);
      core.startGroup("Pivot Output (File)");
      core.info(JSON.stringify(pivotOutput, null, 2));
      core.endGroup();
    } catch (error) {
      core.warning(`Failed to parse pivot output: ${error}`);
      return { applied: false };
    }
  } else {
    throw new Error(
      `No structured output provided and pivot output file not found at: ${filePath || "undefined"}`,
    );
  }

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply pivot output to issue #${issueNumber}`);
    return { applied: true, outcome: pivotOutput.outcome };
  }

  // Handle different outcomes
  if (pivotOutput.outcome === "no_changes_needed") {
    await postSummaryComment(ctx, issueNumber, pivotOutput, []);
    return { applied: true, outcome: "no_changes_needed" };
  }

  if (pivotOutput.outcome === "needs_clarification") {
    await postClarificationComment(ctx, issueNumber, pivotOutput);
    return { applied: true, outcome: "needs_clarification" };
  }

  // Validate safety constraints before applying changes
  const validation = await validateSafetyConstraints(ctx, issueNumber, pivotOutput);
  if (!validation.valid) {
    core.error(`Safety violations detected: ${validation.violations.join(", ")}`);
    await postSafetyViolationComment(ctx, issueNumber, validation.violations);
    return { applied: false, outcome: "safety_violation" };
  }

  // Apply modifications
  const changesApplied: string[] = [];

  // 1. Apply parent issue modifications
  if (pivotOutput.modifications?.parent_issue) {
    const parentChanges = await applyParentModifications(
      ctx,
      issueNumber,
      pivotOutput.modifications.parent_issue,
    );
    changesApplied.push(...parentChanges);
  }

  // 2. Apply sub-issue modifications
  if (pivotOutput.modifications?.sub_issues) {
    const subChanges = await applySubIssueModifications(
      ctx,
      pivotOutput.modifications.sub_issues,
    );
    changesApplied.push(...subChanges);
  }

  // 3. Create new sub-issues (for reversion/extension)
  if (pivotOutput.modifications?.new_sub_issues?.length) {
    const newIssues = await createNewSubIssues(
      ctx,
      issueNumber,
      pivotOutput.modifications.new_sub_issues,
    );
    changesApplied.push(...newIssues);
  }

  // 4. Post summary comment
  await postSummaryComment(ctx, issueNumber, pivotOutput, changesApplied);

  // 5. Update history to mark pivot complete
  await updateHistoryEntry(ctx, issueNumber, pivotOutput.outcome);

  return { applied: true, outcome: pivotOutput.outcome };
}

// ============================================================================
// Safety Validation
// ============================================================================

/**
 * Validate that the pivot doesn't violate safety constraints
 */
async function validateSafetyConstraints(
  ctx: RunnerContext,
  issueNumber: number,
  pivotOutput: PivotOutput,
): Promise<SafetyValidation> {
  const violations: string[] = [];

  if (!pivotOutput.modifications) {
    return { valid: true, violations: [] };
  }

  // Note: We no longer allow todo modifications on parent issues.
  // Todos belong on sub-issues only.

  // Check sub-issue modifications
  if (pivotOutput.modifications.sub_issues) {
    for (const subMod of pivotOutput.modifications.sub_issues) {
      if (subMod.action === "skip") continue;

      // Fetch sub-issue to check state
      try {
        const { data: subIssue } = await ctx.octokit.rest.issues.get({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: subMod.issue_number,
        });

        // Cannot modify closed sub-issues
        if (subIssue.state === "closed") {
          violations.push(`Cannot modify closed sub-issue #${subMod.issue_number}`);
          continue;
        }

        // Check for modifications to checked todos
        if (subMod.todo_modifications) {
          const body = subIssue.body || "";
          const todos = parseTodosFromBody(body);

          for (const mod of subMod.todo_modifications) {
            // Skip 'add' actions - they don't modify existing todos
            if (mod.action === "add") continue;

            // Check if the target index is a checked todo
            if (mod.index >= 0 && mod.index < todos.length) {
              const targetTodo = todos[mod.index];
              if (targetTodo.checked) {
                violations.push(
                  `Cannot ${mod.action} checked todo at index ${mod.index}: "${targetTodo.text}" on sub-issue #${subMod.issue_number}`,
                );
              }
            }
          }
        }
      } catch (error) {
        core.warning(`Failed to fetch sub-issue #${subMod.issue_number}: ${error}`);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parsed todo item
 */
interface ParsedTodo {
  text: string;
  checked: boolean;
  fullMatch: string;
}

/**
 * Parse todos from issue body
 * Returns array of todos with their text, checked status, and full match string
 */
function parseTodosFromBody(body: string): ParsedTodo[] {
  const todoPattern = /- \[([ x])\] (.+?)(?=\n|$)/g;
  const todos: ParsedTodo[] = [];
  let match;

  while ((match = todoPattern.exec(body)) !== null) {
    todos.push({
      checked: match[1] === "x",
      text: match[2],
      fullMatch: match[0],
    });
  }

  return todos;
}

/**
 * Serialize todos back to markdown
 */
function serializeTodos(todos: ParsedTodo[]): string {
  return todos.map((t) => `- [${t.checked ? "x" : " "}] ${t.text}`).join("\n");
}

/**
 * Apply index-based todo modifications to a body
 * Operations are applied in order, with indices recalculated after each operation
 */
function applyTodoModifications(
  body: string,
  modifications: TodoModification[],
): { body: string; changed: boolean; changes: string[] } {
  const changes: string[] = [];

  // Find the todos section in the body
  const todosMatch = body.match(/## Todos\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (!todosMatch) {
    // No todos section - if we're adding, create one
    const addMods = modifications.filter((m) => m.action === "add");
    if (addMods.length > 0) {
      const newTodos = addMods.map((m) => `- [ ] ${m.text}`).join("\n");
      const newBody = body.trimEnd() + `\n\n## Todos\n\n${newTodos}\n`;
      changes.push(`Added ${addMods.length} todo(s)`);
      return { body: newBody, changed: true, changes };
    }
    return { body, changed: false, changes: [] };
  }

  // Parse existing todos
  let todos = parseTodosFromBody(body);
  let hasChanges = false;

  // Apply each modification in order
  for (const mod of modifications) {
    switch (mod.action) {
      case "add": {
        if (!mod.text) {
          core.warning(`Add operation missing text, skipping`);
          continue;
        }
        const newTodo: ParsedTodo = {
          text: mod.text,
          checked: false,
          fullMatch: `- [ ] ${mod.text}`,
        };
        // index -1 means prepend, otherwise insert after the index
        const insertAt = mod.index < 0 ? 0 : Math.min(mod.index + 1, todos.length);
        todos.splice(insertAt, 0, newTodo);
        changes.push(`Added todo at position ${insertAt}: "${mod.text}"`);
        hasChanges = true;
        break;
      }

      case "modify": {
        if (!mod.text) {
          core.warning(`Modify operation missing text, skipping`);
          continue;
        }
        if (mod.index < 0 || mod.index >= todos.length) {
          core.warning(`Modify index ${mod.index} out of bounds (0-${todos.length - 1}), skipping`);
          continue;
        }
        const oldText = todos[mod.index].text;
        todos[mod.index].text = mod.text;
        todos[mod.index].fullMatch = `- [${todos[mod.index].checked ? "x" : " "}] ${mod.text}`;
        changes.push(`Modified todo ${mod.index}: "${oldText}" → "${mod.text}"`);
        hasChanges = true;
        break;
      }

      case "remove": {
        if (mod.index < 0 || mod.index >= todos.length) {
          core.warning(`Remove index ${mod.index} out of bounds (0-${todos.length - 1}), skipping`);
          continue;
        }
        const removedText = todos[mod.index].text;
        todos.splice(mod.index, 1);
        changes.push(`Removed todo ${mod.index}: "${removedText}"`);
        hasChanges = true;
        break;
      }
    }
  }

  if (!hasChanges) {
    return { body, changed: false, changes: [] };
  }

  // Rebuild the body with updated todos
  const serializedTodos = serializeTodos(todos);
  const newBody = body.replace(
    /## Todos\s*\n[\s\S]*?(?=\n## |$)/i,
    `## Todos\n\n${serializedTodos}\n`,
  );

  return { body: newBody, changed: true, changes };
}

// ============================================================================
// Apply Modifications
// ============================================================================

/**
 * Apply modifications to the parent issue
 */
async function applyParentModifications(
  ctx: RunnerContext,
  issueNumber: number,
  mods: ParentIssueModifications,
): Promise<string[]> {
  const changes: string[] = [];

  try {
    // Get current issue body
    const { data: issue } = await ctx.octokit.rest.issues.get({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
    });

    let body = issue.body || "";
    let modified = false;

    // Update sections
    if (mods.update_sections) {
      for (const [sectionName, newContent] of Object.entries(mods.update_sections)) {
        const sectionRegex = new RegExp(
          `(## ${escapeRegex(sectionName)}\\s*\\n)([\\s\\S]*?)(?=\\n## |$)`,
          "i",
        );

        if (sectionRegex.test(body)) {
          body = body.replace(sectionRegex, `$1${newContent}\n\n`);
          changes.push(`Updated "${sectionName}" section`);
          modified = true;
        } else {
          // Add new section at the end (before Agent Notes/Iteration History if present)
          const insertPoint = body.search(/\n## (?:Agent Notes|Iteration History)/i);
          const newSection = `\n## ${sectionName}\n\n${newContent}\n`;
          if (insertPoint !== -1) {
            body = body.slice(0, insertPoint) + newSection + body.slice(insertPoint);
          } else {
            body += newSection;
          }
          changes.push(`Added "${sectionName}" section`);
          modified = true;
        }
      }
    }

    // Note: Todos are not added/removed from parent issues.
    // Todos belong on sub-issues. If Claude output includes parent todos,
    // they are ignored here. The prompt and schema should guide Claude
    // to put todos on sub-issues instead.

    // Update issue if modified
    if (modified) {
      await ctx.octokit.rest.issues.update({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: issueNumber,
        body,
      });
      core.info(`Updated parent issue #${issueNumber}`);
    }
  } catch (error) {
    core.warning(`Failed to apply parent modifications: ${error}`);
  }

  return changes.length > 0 ? [`**Parent Issue #${issueNumber}:**\n${changes.map((c) => `- ${c}`).join("\n")}`] : [];
}

/**
 * Apply modifications to sub-issues
 */
async function applySubIssueModifications(
  ctx: RunnerContext,
  subMods: SubIssueModification[],
): Promise<string[]> {
  const changes: string[] = [];

  for (const subMod of subMods) {
    if (subMod.action === "skip") continue;

    const subChanges: string[] = [];

    try {
      const { data: subIssue } = await ctx.octokit.rest.issues.get({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: subMod.issue_number,
      });

      let body = subIssue.body || "";
      let modified = false;

      // Apply index-based todo modifications
      if (subMod.todo_modifications && subMod.todo_modifications.length > 0) {
        const result = applyTodoModifications(body, subMod.todo_modifications);
        if (result.changed) {
          body = result.body;
          subChanges.push(...result.changes);
          modified = true;
        }
      }

      // Update description
      if (subMod.update_description) {
        body += `\n\n---\n\n**Pivot Update:**\n${subMod.update_description}`;
        subChanges.push("Added pivot update description");
        modified = true;
      }

      if (modified) {
        await ctx.octokit.rest.issues.update({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: subMod.issue_number,
          body,
        });
        core.info(`Updated sub-issue #${subMod.issue_number}`);
      }

      if (subChanges.length > 0) {
        changes.push(`**Sub-Issue #${subMod.issue_number}:**\n${subChanges.map((c) => `- ${c}`).join("\n")}`);
      }
    } catch (error) {
      core.warning(`Failed to modify sub-issue #${subMod.issue_number}: ${error}`);
    }
  }

  return changes;
}

/**
 * Create new sub-issues for reversion/extension
 */
async function createNewSubIssues(
  ctx: RunnerContext,
  parentIssueNumber: number,
  newSubIssues: NewSubIssue[],
): Promise<string[]> {
  const changes: string[] = [];

  for (const newSub of newSubIssues) {
    try {
      // Build issue body
      const reasonEmoji = newSub.reason === "reversion" ? "↩️" : newSub.reason === "extension" ? "➕" : "🆕";
      const reasonLabel = newSub.reason === "reversion"
        ? "Reversion"
        : newSub.reason === "extension"
          ? "Extension"
          : "New Scope";

      let body = `**${reasonEmoji} ${reasonLabel}** - Created from pivot request on #${parentIssueNumber}\n\n`;
      body += `${newSub.description}\n\n`;
      body += `## Tasks\n\n`;
      body += newSub.todos.map((t) => `- [ ] ${t}`).join("\n");

      // Create the issue
      const { data: createdIssue } = await ctx.octokit.rest.issues.create({
        owner: ctx.owner,
        repo: ctx.repo,
        title: `[${reasonLabel}] ${newSub.title}`,
        body,
        labels: ["pivot-generated"],
      });

      // Link as sub-issue to parent (if GraphQL API supports it)
      // Note: Sub-issue linking may require specific API support

      core.info(`Created new sub-issue #${createdIssue.number}: ${newSub.title}`);
      changes.push(`**New Sub-Issue #${createdIssue.number}:** ${newSub.title} (${newSub.reason})`);
    } catch (error) {
      core.warning(`Failed to create new sub-issue "${newSub.title}": ${error}`);
    }
  }

  return changes;
}

// ============================================================================
// Comments
// ============================================================================

/**
 * Post summary comment after pivot
 */
async function postSummaryComment(
  ctx: RunnerContext,
  issueNumber: number,
  pivotOutput: PivotOutput,
  changesApplied: string[],
): Promise<void> {
  let body = `## Pivot Summary\n\n`;
  body += `${pivotOutput.summary_for_user}\n\n`;

  if (changesApplied.length > 0) {
    body += `### Changes Applied\n\n`;
    body += changesApplied.join("\n\n");
    body += "\n\n";
  }

  if (pivotOutput.analysis.affects_completed_work && pivotOutput.analysis.completed_work_details?.length) {
    body += `### Completed Work Note\n\n`;
    body += `New sub-issues were created because some changes affect already-completed work.\n\n`;
  }

  body += `---\n`;
  body += `**Next Steps:** Review the changes above. When ready to continue, comment \`/lfg\` to resume work.\n\n`;
  body += `*Use \`/pivot\` again if changes don't match your intent.*`;

  try {
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
    core.info(`Posted pivot summary comment on #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to post summary comment: ${error}`);
  }
}

/**
 * Post clarification needed comment
 */
async function postClarificationComment(
  ctx: RunnerContext,
  issueNumber: number,
  pivotOutput: PivotOutput,
): Promise<void> {
  let body = `## Pivot - Clarification Needed\n\n`;
  body += `${pivotOutput.summary_for_user}\n\n`;
  body += `### What I Need\n\n`;
  body += pivotOutput.clarification_needed || "Please provide more details about the changes you want to make.";
  body += `\n\n---\n`;
  body += `*Reply with more details, then use \`/pivot <your clarification>\` to try again.*`;

  try {
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
    core.info(`Posted clarification request on #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to post clarification comment: ${error}`);
  }
}

/**
 * Post safety violation comment
 */
async function postSafetyViolationComment(
  ctx: RunnerContext,
  issueNumber: number,
  violations: string[],
): Promise<void> {
  let body = `## Pivot - Safety Violation\n\n`;
  body += `The requested pivot cannot be applied because it would violate safety constraints:\n\n`;
  body += violations.map((v) => `- ❌ ${v}`).join("\n");
  body += `\n\n### Why These Constraints Exist\n\n`;
  body += `- **Checked todos** represent completed work that should not be undone silently\n`;
  body += `- **Closed sub-issues** represent completed phases that are immutable\n\n`;
  body += `### What You Can Do Instead\n\n`;
  body += `If you need to change completed work, ask for a **new sub-issue** to revert or extend it. `;
  body += `For example: \`/pivot Create a new phase to remove the MCP configuration that was added in Phase 1\`\n\n`;
  body += `---\n`;
  body += `*Modify your pivot request to avoid these violations and try again.*`;

  try {
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
    core.info(`Posted safety violation comment on #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to post safety violation comment: ${error}`);
  }
}

/**
 * Update the history entry to mark pivot complete
 */
async function updateHistoryEntry(
  ctx: RunnerContext,
  issueNumber: number,
  outcome: string,
): Promise<void> {
  try {
    const { data: issue } = await ctx.octokit.rest.issues.get({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
    });

    let body = issue.body || "";

    // Replace the "Analyzing pivot request..." with the outcome
    const outcomeEmoji = outcome === "changes_applied" ? "✅" : outcome === "needs_clarification" ? "❓" : "➖";
    const outcomeText = outcome === "changes_applied"
      ? "Pivot applied"
      : outcome === "needs_clarification"
        ? "Needs clarification"
        : "No changes needed";

    body = body.replace(
      /⏳ Analyzing pivot request\.\.\./g,
      `${outcomeEmoji} ${outcomeText}`,
    );

    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
  } catch (error) {
    core.warning(`Failed to update history entry: ${error}`);
  }
}
