/**
 * Pivot Executor
 *
 * Applies pivot output from Claude's structured analysis.
 * Uses parseIssue + MDAST mutators + update pattern (no direct octokit.rest.issues calls).
 */

import * as core from "@actions/core";
import * as fs from "fs";
import {
  addSubIssueToParent,
  parseMarkdown,
  createComment,
  parseIssue,
  type OctokitLike,
} from "@more/issue-state";
import type { RootContent } from "mdast";
import type { ApplyPivotOutputAction } from "../../schemas/index.js";
import {
  upsertSection,
  applyTodoModifications,
  replaceBody,
} from "../../parser/index.js";
import type { RunnerContext } from "../types.js";
import {
  PivotOutputSchema,
  parseOutput,
  type PivotOutput,
} from "./output-schemas.js";

// Helper to cast RunnerContext octokit to OctokitLike

function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
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
 */
export async function executeApplyPivotOutput(
  action: ApplyPivotOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; changesApplied: number }> {
  let pivotOutput: PivotOutput;

  // Try structured output first, then fall back to file
  if (structuredOutput) {
    pivotOutput = parseOutput(PivotOutputSchema, structuredOutput, "pivot");
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
    pivotOutput = parseOutput(
      PivotOutputSchema,
      JSON.parse(content),
      "pivot file",
    );
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
    await createComment(
      ctx.owner,
      ctx.repo,
      action.issueNumber,
      `## Pivot Needs Clarification\n\n${pivotOutput.clarification_needed || pivotOutput.summary_for_user}\n\n*Please provide more details and try again.*`,
      asOctokitLike(ctx),
    );
    return { applied: false, changesApplied: 0 };
  }

  if (pivotOutput.outcome === "no_changes_needed") {
    core.info("No changes needed");
    await createComment(
      ctx.owner,
      ctx.repo,
      action.issueNumber,
      `## Pivot Analysis\n\n${pivotOutput.summary_for_user}\n\n*No changes were required.*`,
      asOctokitLike(ctx),
    );
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
    const { data: parentData, update: parentUpdate } = await parseIssue(
      ctx.owner,
      ctx.repo,
      action.issueNumber,
      {
        octokit: asOctokitLike(ctx),
        fetchPRs: false,
        fetchParent: false,
      },
    );

    let parentState = parentData;
    for (const [section, content] of Object.entries(
      mods.parent_issue.update_sections,
    )) {
      core.info(`Updating parent issue section "${section}"`);
      const sectionAst = parseMarkdown(content);
      const sectionContent: RootContent[] =
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mdast children are RootContent[]
        sectionAst.children as RootContent[];
      parentState = upsertSection(
        { title: section, content: sectionContent },
        parentState,
      );
    }

    await parentUpdate(parentState);
    core.info(`Updated parent issue body`);
  }

  // Apply sub-issue modifications
  if (mods?.sub_issues) {
    for (const subIssue of mods.sub_issues) {
      if (subIssue.action === "skip") continue;

      core.info(`Modifying sub-issue #${subIssue.issue_number}`);

      const { data: subData, update: subUpdate } = await parseIssue(
        ctx.owner,
        ctx.repo,
        subIssue.issue_number,
        {
          octokit: asOctokitLike(ctx),
          fetchPRs: false,
          fetchParent: false,
        },
      );

      let subState = subData;

      // Apply todo modifications
      if (
        subIssue.todo_modifications &&
        subIssue.todo_modifications.length > 0
      ) {
        subState = applyTodoModifications(
          { modifications: subIssue.todo_modifications },
          subState,
        );
      }

      // Apply description update
      if (subIssue.update_description) {
        subState = replaceBody(
          { bodyAst: parseMarkdown(subIssue.update_description) },
          subState,
        );
      }

      await subUpdate(subState);
      core.info(`Updated sub-issue #${subIssue.issue_number}`);
    }
  }

  // Create new sub-issues
  if (mods?.new_sub_issues && mods.new_sub_issues.length > 0) {
    core.info(`Creating ${mods.new_sub_issues.length} new sub-issues`);

    for (const newSubIssue of mods.new_sub_issues) {
      // Build body with todos
      const todoList = newSubIssue.todos.map((t) => `- [ ] ${t}`).join("\n");
      const bodyText = `${newSubIssue.description}\n\n## Todo\n\n${todoList}`;
      const bodyAst = parseMarkdown(bodyText);

      try {
        const result = await addSubIssueToParent(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          { title: newSubIssue.title, body: bodyAst },
          {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
            octokit: asOctokitLike(ctx) as Parameters<
              typeof addSubIssueToParent
            >[4]["octokit"],
          },
        );

        core.info(
          `Created sub-issue #${result.issueNumber}: ${newSubIssue.title} (${newSubIssue.reason})`,
        );
      } catch (error) {
        core.warning(`Failed to create sub-issue: ${error}`);
      }
    }
  }

  // Post summary comment
  await createComment(
    ctx.owner,
    ctx.repo,
    action.issueNumber,
    `## Pivot Applied\n\n${pivotOutput.summary_for_user}\n\n*${changesApplied} changes applied. Review and use \`/lfg\` to continue.*`,
    asOctokitLike(ctx),
  );

  core.info(`Applied ${changesApplied} pivot changes`);
  return { applied: true, changesApplied };
}
