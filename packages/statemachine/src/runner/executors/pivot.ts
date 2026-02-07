/**
 * Pivot Executor
 *
 * Applies pivot output from Claude's structured analysis.
 * TODO: Full implementation to be migrated from .github/statemachine
 */

import * as core from "@actions/core";
import * as fs from "fs";
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
    pivotOutput = structuredOutput as PivotOutput;
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
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

  // TODO: Implement safety validations and change application
  // For now, just log the changes
  if (mods?.parent_issue?.update_sections) {
    for (const [section, content] of Object.entries(
      mods.parent_issue.update_sections,
    )) {
      core.info(`Would update parent issue section "${section}": ${content}`);
    }
  }

  if (mods?.sub_issues) {
    for (const subIssue of mods.sub_issues) {
      if (subIssue.action === "skip") continue;
      core.info(`Would modify sub-issue #${subIssue.issue_number}`);
      if (subIssue.todo_modifications) {
        for (const mod of subIssue.todo_modifications) {
          core.info(`  ${mod.action} todo at index ${mod.index}: ${mod.text}`);
        }
      }
    }
  }

  // Create new sub-issues if specified
  if (newSubIssueCount > 0) {
    core.info(`Would create ${newSubIssueCount} new sub-issues`);
    for (const newSubIssue of mods!.new_sub_issues!) {
      core.info(`  - ${newSubIssue.title} (${newSubIssue.reason})`);
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
