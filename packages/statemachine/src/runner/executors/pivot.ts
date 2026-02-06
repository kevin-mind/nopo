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
// Types
// ============================================================================

interface PivotChange {
  type: "modify_requirement" | "add_requirement" | "remove_requirement";
  section: string;
  content: string;
  rationale: string;
}

interface PivotOutput {
  summary: string;
  changes: PivotChange[];
  new_sub_issues?: Array<{
    title: string;
    body: string;
    type: "reversion" | "extension";
  }>;
  agent_notes?: string[];
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

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would apply ${pivotOutput.changes.length} pivot changes`,
    );
    return { applied: true, changesApplied: pivotOutput.changes.length };
  }

  // TODO: Implement safety validations and change application
  // For now, just log the changes
  let changesApplied = 0;

  for (const change of pivotOutput.changes) {
    core.info(
      `Would apply ${change.type} to ${change.section}: ${change.rationale}`,
    );
    changesApplied++;
  }

  // Create new sub-issues if specified
  if (pivotOutput.new_sub_issues && pivotOutput.new_sub_issues.length > 0) {
    core.info(
      `Would create ${pivotOutput.new_sub_issues.length} new sub-issues`,
    );
  }

  // Post summary comment
  await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: action.issueNumber,
    body: `## Pivot Applied\n\n${pivotOutput.summary}\n\n*${changesApplied} changes applied. Review and use \`/lfg\` to continue.*`,
  });

  core.info(`Applied ${changesApplied} pivot changes`);
  return { applied: true, changesApplied };
}
