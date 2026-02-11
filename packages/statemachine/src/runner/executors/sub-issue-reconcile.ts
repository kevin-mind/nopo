/**
 * Sub-Issue Reconciliation Executor
 *
 * AI-driven semantic matching of existing sub-issues against expected phases.
 * Produces three buckets: create, update, delete.
 */

import * as core from "@actions/core";
import type { Root } from "mdast";
import {
  addSubIssueToParent,
  createSection,
  createParagraph,
  createBulletList,
  createTodoList,
  parseIssue,
  type OctokitLike,
  type ProjectStatus,
} from "@more/issue-state";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import type { ReconcileSubIssuesAction } from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { appendAgentNotes, extractSubIssueSpecs } from "../../parser/index.js";
import {
  ReconcileSubIssuesOutputSchema,
  parseOutput,
  type SubIssueSpec,
} from "./output-schemas.js";

// Helper to cast RunnerContext octokit to OctokitLike

function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
}

// ============================================================================
// Helpers (moved from grooming.ts)
// ============================================================================

/**
 * Build the body for a phase sub-issue as MDAST
 */
export function buildPhaseIssueBody(phase: SubIssueSpec): Root {
  // Use unknown[] to avoid type conflicts with MdastNode vs RootContent
  // The MDAST nodes are structurally compatible, just typed differently
  const children: unknown[] = [];

  // Description section
  children.push(
    ...createSection("Description", [createParagraph(phase.description)]),
  );

  // Affected Areas section
  if (phase.affected_areas && phase.affected_areas.length > 0) {
    const areas = phase.affected_areas.map((area) => {
      const changeType = area.change_type ? ` (${area.change_type})` : "";
      const desc = area.description ? ` - ${area.description}` : "";
      return `\`${area.path}\`${changeType}${desc}`;
    });
    children.push(
      ...createSection("Affected Areas", [createBulletList(areas)]),
    );
  }

  // Todo section
  if (phase.todos && phase.todos.length > 0) {
    const todos = phase.todos.map((todo) => ({
      text: todo.task,
      checked: false,
      manual: todo.manual || false,
    }));
    children.push(...createSection("Todo", [createTodoList(todos)]));
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- unknown[] contains valid RootContent nodes, cast avoids complex type conflicts
  return { type: "root", children: children as Root["children"] };
}

/**
 * Extract todo items from a sub-issue's body AST.
 * Returns an array of { text, checked } for merging.
 */
export function extractExistingTodos(
  bodyAst: Root,
): Array<{ text: string; checked: boolean }> {
  const result: Array<{ text: string; checked: boolean }> = [];
  for (const node of bodyAst.children) {
    if (node.type === "list") {
      for (const item of node.children) {
        if (item.type === "listItem" && typeof item.checked === "boolean") {
          // Get text from the list item's paragraph children
          const text = item.children
            .map((child) => {
              if ("children" in child && Array.isArray(child.children)) {
                return child.children
                  .map((n) => {
                    if (n.type === "text") return n.value;
                    if (n.type === "inlineCode") return n.value;
                    return "";
                  })
                  .join("");
              }
              return "";
            })
            .join("");
          result.push({ text, checked: item.checked });
        }
      }
    }
  }
  return result;
}

/**
 * Normalize todo text for comparison (lowercase, collapse whitespace).
 */
export function normalizeTodoText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a merged todo list for a sub-issue.
 * - Preserves checked state from existing todos
 * - Adds new todos that don't match any existing ones
 */
export function mergeTodos(
  newTodos: Array<{ task: string; manual?: boolean }>,
  existingTodos: Array<{ text: string; checked: boolean }>,
): Array<{ text: string; checked: boolean; manual: boolean }> {
  const existingByNorm = new Map<string, { text: string; checked: boolean }>();
  for (const t of existingTodos) {
    existingByNorm.set(normalizeTodoText(t.text), t);
  }

  const merged: Array<{ text: string; checked: boolean; manual: boolean }> = [];
  const usedExisting = new Set<string>();

  // Process new todos: check if they match existing ones
  for (const newTodo of newTodos) {
    const norm = normalizeTodoText(newTodo.task);
    const existing = existingByNorm.get(norm);
    if (existing) {
      // Preserve the existing checked state
      merged.push({
        text: newTodo.task,
        checked: existing.checked,
        manual: newTodo.manual || false,
      });
      usedExisting.add(norm);
    } else {
      merged.push({
        text: newTodo.task,
        checked: false,
        manual: newTodo.manual || false,
      });
    }
  }

  // Preserve existing todos not in the new list (user may have added custom ones)
  for (const existing of existingTodos) {
    const norm = normalizeTodoText(existing.text);
    if (!usedExisting.has(norm)) {
      merged.push({
        text: existing.text,
        checked: existing.checked,
        manual: false,
      });
    }
  }

  return merged;
}

// ============================================================================
// Reconcile Sub-Issues Executor
// ============================================================================

/**
 * Reconcile sub-issues using AI-driven semantic matching.
 *
 * When there are no existing sub-issues, creates all phases directly (simple path).
 * When existing sub-issues exist, runs a reconciliation prompt to produce
 * create/update/delete buckets, then applies them.
 */
export async function executeReconcileSubIssues(
  action: ReconcileSubIssuesAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{
  reconciled: boolean;
  created: number;
  updated: number;
  deleted: number;
}> {
  // Extract decision and recommendedPhases from chain output
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- chain output shape from applyGroomingOutput
  const chainOutput = structuredOutput as
    | {
        applied: boolean;
        decision: string;
        recommendedPhases?: SubIssueSpec[];
      }
    | undefined;

  if (!chainOutput || chainOutput.decision !== "ready") {
    core.info(
      `Skipping reconciliation: decision is "${chainOutput?.decision ?? "unknown"}", not "ready"`,
    );
    return { reconciled: false, created: 0, updated: 0, deleted: 0 };
  }

  const recommendedPhases = chainOutput.recommendedPhases;
  if (!recommendedPhases || recommendedPhases.length === 0) {
    core.info("Skipping reconciliation: no recommended phases");
    return { reconciled: false, created: 0, updated: 0, deleted: 0 };
  }

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would reconcile ${recommendedPhases.length} phases for issue #${action.issueNumber}`,
    );
    return { reconciled: true, created: 0, updated: 0, deleted: 0 };
  }

  // Fetch fresh issue data to get current sub-issues
  const { data } = await parseIssue(ctx.owner, ctx.repo, action.issueNumber, {
    octokit: asOctokitLike(ctx),
    fetchPRs: false,
    fetchParent: false,
  });

  const existingSubIssues = extractSubIssueSpecs(data.issue.subIssues);

  // Simple path: no existing sub-issues → create all phases directly
  if (existingSubIssues.length === 0) {
    core.info(
      `No existing sub-issues, creating ${recommendedPhases.length} phases directly`,
    );
    const created = await createAllPhases(
      ctx,
      action.issueNumber,
      recommendedPhases,
      data.issue.subIssues.length === 0,
    );
    return { reconciled: true, created, updated: 0, deleted: 0 };
  }

  // Reconciliation path: run prompt to match existing vs expected
  core.info(
    `Reconciling ${existingSubIssues.length} existing sub-issues against ${recommendedPhases.length} expected phases`,
  );

  const resolved = resolvePrompt({
    promptDir: "grooming/reconcile-sub-issues",
    promptVars: {
      ISSUE_NUMBER: String(action.issueNumber),
      ISSUE_TITLE: data.issue.title,
      EXISTING_SUB_ISSUES: JSON.stringify(existingSubIssues, null, 2),
      EXPECTED_SUB_ISSUES: JSON.stringify(recommendedPhases, null, 2),
    },
  });

  core.startGroup("Reconcile Sub-Issues");
  const result = await executeClaudeSDK({
    prompt: resolved.prompt,
    cwd: process.cwd(),
    outputSchema: resolved.outputSchema,
  });
  core.endGroup();

  if (!result.success || !result.structuredOutput) {
    core.warning(
      `Reconciliation prompt failed: ${result.error || "no structured output"}. Falling back to creating all phases.`,
    );
    const created = await createAllPhases(
      ctx,
      action.issueNumber,
      recommendedPhases,
      false,
    );
    return { reconciled: true, created, updated: 0, deleted: 0 };
  }

  const reconcileOutput = parseOutput(
    ReconcileSubIssuesOutputSchema,
    result.structuredOutput,
    "reconcile sub-issues",
  );

  core.info(
    `Reconciliation result: ${reconcileOutput.create.length} create, ${reconcileOutput.update.length} update, ${reconcileOutput.delete.length} delete`,
  );
  core.info(`Reasoning: ${reconcileOutput.reasoning}`);

  // Apply create bucket
  let created = 0;
  for (const spec of reconcileOutput.create) {
    try {
      const body = buildPhaseIssueBody(spec);
      const title = `[Phase ${spec.phase_number}]: ${spec.title}`;
      const projectStatus: ProjectStatus | undefined = undefined;

      const createResult = await addSubIssueToParent(
        ctx.owner,
        ctx.repo,
        action.issueNumber,
        { title, body },
        {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
          octokit: ctx.octokit as Parameters<
            typeof addSubIssueToParent
          >[4]["octokit"],
          projectNumber: ctx.projectNumber,
          projectStatus,
        },
      );

      core.info(`Created sub-issue #${createResult.issueNumber}: ${title}`);
      created++;
    } catch (error) {
      core.error(
        `Failed to create sub-issue for phase ${spec.phase_number}: ${error}`,
      );
    }
  }

  // Apply update bucket
  let updated = 0;
  for (const spec of reconcileOutput.update) {
    try {
      const { data: subData, update: subUpdate } = await parseIssue(
        ctx.owner,
        ctx.repo,
        spec.number,
        {
          octokit: asOctokitLike(ctx),
          fetchPRs: false,
          fetchParent: false,
        },
      );

      // Merge todos: preserve checked state from existing
      const existingTodos = extractExistingTodos(subData.issue.bodyAst);
      const mergedTodos = mergeTodos(spec.todos ?? [], existingTodos);

      // Build fresh body with merged content
      const newBody = buildPhaseIssueBody({
        ...spec,
        todos: mergedTodos.map((t) => ({
          task: t.text,
          manual: t.manual,
        })),
      });

      // Rebuild with merged todo checked states
      for (const node of newBody.children) {
        if (node.type === "list") {
          for (let i = 0; i < node.children.length; i++) {
            const item = node.children[i];
            const merged = mergedTodos[i];
            if (
              item &&
              merged &&
              item.type === "listItem" &&
              typeof item.checked === "boolean"
            ) {
              item.checked = merged.checked;
            }
          }
        }
      }

      const title = `[Phase ${spec.phase_number}]: ${spec.title}`;
      await subUpdate({
        ...subData,
        issue: {
          ...subData.issue,
          title,
          bodyAst: newBody,
        },
      });

      core.info(
        `Updated sub-issue #${spec.number}: ${title} (reason: ${spec.match_reason})`,
      );
      updated++;
    } catch (error) {
      core.error(`Failed to update sub-issue #${spec.number}: ${error}`);
    }
  }

  // Apply delete bucket
  let deleted = 0;
  for (const entry of reconcileOutput.delete) {
    try {
      // Close the sub-issue with a comment
      await ctx.octokit.rest.issues.createComment({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: entry.number,
        body: `Closing: this sub-issue was superseded during grooming reconciliation.\n\n**Reason:** ${entry.reason}`,
      });

      await ctx.octokit.rest.issues.update({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: entry.number,
        state: "closed",
        state_reason: "not_planned",
      });

      core.info(`Closed sub-issue #${entry.number}: ${entry.reason}`);
      deleted++;
    } catch (error) {
      core.error(`Failed to close sub-issue #${entry.number}: ${error}`);
    }
  }

  // Append agent notes to parent
  const changes = [
    created > 0 ? `${created} created` : "",
    updated > 0 ? `${updated} updated` : "",
    deleted > 0 ? `${deleted} closed` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (changes) {
    try {
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

      const parentState = appendAgentNotes(
        {
          runId: `reconcile-${Date.now()}`,
          runLink: "",
          notes: [
            `Sub-issue reconciliation complete. ${changes}.`,
            `Reasoning: ${reconcileOutput.reasoning}`,
          ],
        },
        parentData,
      );

      if (parentState !== parentData) {
        await parentUpdate(parentState);
      }
      core.info(
        `Updated parent issue #${action.issueNumber} with reconciliation notes`,
      );
    } catch (error) {
      core.warning(`Failed to update parent issue body: ${error}`);
    }
  }

  return { reconciled: true, created, updated, deleted };
}

// ============================================================================
// Simple Path: Create All Phases
// ============================================================================

/**
 * Create all phases as new sub-issues (no reconciliation needed).
 */
async function createAllPhases(
  ctx: RunnerContext,
  parentIssueNumber: number,
  phases: SubIssueSpec[],
  isFirstBatch: boolean,
): Promise<number> {
  let created = 0;

  for (const phase of phases) {
    const title = `[Phase ${phase.phase_number}]: ${phase.title}`;
    const body = buildPhaseIssueBody(phase);
    const projectStatus: ProjectStatus | undefined =
      phase.phase_number === 1 && isFirstBatch ? "Ready" : undefined;

    try {
      const result = await addSubIssueToParent(
        ctx.owner,
        ctx.repo,
        parentIssueNumber,
        { title, body },
        {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
          octokit: ctx.octokit as Parameters<
            typeof addSubIssueToParent
          >[4]["octokit"],
          projectNumber: ctx.projectNumber,
          projectStatus,
        },
      );

      core.info(`Created sub-issue #${result.issueNumber}: ${title}`);
      created++;
    } catch (error) {
      core.error(
        `Failed to create sub-issue for phase ${phase.phase_number}: ${error}`,
      );
    }
  }

  // Append agent notes to parent
  if (created > 0) {
    try {
      const { data: parentData, update: parentUpdate } = await parseIssue(
        ctx.owner,
        ctx.repo,
        parentIssueNumber,
        {
          octokit: asOctokitLike(ctx),
          fetchPRs: false,
          fetchParent: false,
        },
      );

      const parentState = appendAgentNotes(
        {
          runId: `reconcile-${Date.now()}`,
          runLink: "",
          notes: [`Grooming complete. Created ${created} sub-issue(s).`],
        },
        parentData,
      );

      if (parentState !== parentData) {
        await parentUpdate(parentState);
      }
    } catch (error) {
      core.warning(`Failed to update parent issue body: ${error}`);
    }
  }

  return created;
}
