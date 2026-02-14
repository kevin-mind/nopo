/**
 * Grooming Actions
 *
 * Actions for applying grooming output, reconciling sub-issues,
 * and exported helper utilities for tests.
 */

import { z } from "zod";
import * as core from "@actions/core";
import * as fs from "fs";
import type { Root, RootContent, List } from "mdast";
import {
  addSubIssueToParent,
  createSection,
  createParagraph,
  createBulletList,
  createTodoList,
  parseIssue,
  parseMarkdown,
} from "@more/issue-state";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import {
  CombinedGroomingOutputSchema,
  EngineerOutputSchema,
  GroomingSummaryOutputSchema,
  ReconcileSubIssuesOutputSchema,
  parseOutput,
  type CombinedGroomingOutput,
  type GroomingSummaryOutput,
  type SubIssueSpec,
} from "../../runner/helpers/output-schemas.js";
import {
  appendAgentNotes,
  upsertSection,
  extractQuestionItems,
  extractSubIssueSpecs,
  type QuestionItem,
} from "../../parser/index.js";
import type { RunnerContext } from "../../runner/types.js";
import {
  mkSchema,
  defAction,
  asOctokitLike,
  getStructuredOutput,
} from "./_shared.js";

// ============================================================================
// Exported Helpers (used by tests)
// ============================================================================

/**
 * Build the body for a phase sub-issue as MDAST
 */
export function buildPhaseIssueBody(phase: SubIssueSpec): Root {
  const children: unknown[] = [];

  children.push(
    ...createSection("Description", [createParagraph(phase.description)]),
  );

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

  if (phase.todos && phase.todos.length > 0) {
    const todos = phase.todos.map((todo) => ({
      text: todo.task,
      checked: false,
      manual: todo.manual || false,
    }));
    children.push(...createSection("Todo", [createTodoList(todos)]));
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- unknown[] contains valid RootContent nodes
  return { type: "root", children: children as Root["children"] };
}

/**
 * Extract todo items from a sub-issue's body AST.
 */
export function extractExistingTodos(
  bodyAst: Root,
): Array<{ text: string; checked: boolean }> {
  const result: Array<{ text: string; checked: boolean }> = [];
  for (const node of bodyAst.children) {
    if (node.type === "list") {
      for (const item of node.children) {
        if (item.type === "listItem" && typeof item.checked === "boolean") {
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
 * Preserves checked state from existing todos, adds new ones.
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

  for (const newTodo of newTodos) {
    const norm = normalizeTodoText(newTodo.task);
    const existing = existingByNorm.get(norm);
    if (existing) {
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

/**
 * Build a fallback summary when the summary prompt fails.
 */
export function buildFallbackSummary(
  groomingOutput: CombinedGroomingOutput,
): GroomingSummaryOutput {
  const consolidated: GroomingSummaryOutput["consolidated_questions"] = [];
  let idx = 0;

  for (const [agentType, output] of Object.entries(groomingOutput)) {
    if (output.questions && output.questions.length > 0) {
      for (const q of output.questions) {
        consolidated.push({
          id: `fallback-${idx++}`,
          title: q.length > 60 ? q.slice(0, 57) + "..." : q,
          description: q,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- agentType is a known key
          sources: [agentType as "pm" | "engineer" | "qa" | "research"],
          priority: "important",
        });
      }
    }
  }

  return {
    summary: "Grooming summary prompt failed, showing raw agent questions.",
    decision: "needs_info",
    decision_rationale: "Summary prompt failed; falling back to raw questions.",
    consolidated_questions: consolidated,
  };
}

/**
 * Parse a markdown line into MDAST list item children.
 */
function parseMarkdownLine(markdown: string): RootContent[] {
  const ast = parseMarkdown(markdown);
  const firstChild = ast.children[0];
  if (firstChild && "children" in firstChild) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- paragraph children are phrasing content
    return (firstChild as { children: RootContent[] }).children;
  }
  return [{ type: "text", value: markdown }];
}

/**
 * Build questions content as MDAST RootContent[] for upsertSection.
 */
export function buildQuestionsContent(
  summary: GroomingSummaryOutput,
  existingQuestions: QuestionItem[],
): RootContent[] {
  const pending = summary.consolidated_questions ?? [];
  const answered = summary.answered_questions ?? [];

  if (
    pending.length === 0 &&
    answered.length === 0 &&
    existingQuestions.length === 0
  ) {
    return [];
  }

  const newIds = new Set<string>();
  for (const q of pending) newIds.add(q.id);
  for (const q of answered) newIds.add(q.id);

  const existingById = new Map<string, QuestionItem>();
  for (const q of existingQuestions) {
    if (q.id) existingById.set(q.id, q);
  }

  const hasSummaryOutput = pending.length > 0 || answered.length > 0;
  const listItems: unknown[] = [];

  if (!hasSummaryOutput) {
    for (const q of existingQuestions) {
      if (!q.id) {
        listItems.push({
          type: "listItem",
          checked: q.checked,
          children: [
            { type: "paragraph", children: parseMarkdownLine(q.text) },
          ],
        });
      }
    }
  }

  for (const q of pending) {
    const existing = existingById.get(q.id);
    const checked = existing?.checked ?? false;
    const sources = q.sources.join(", ");
    const priority = q.priority === "critical" ? " **[critical]**" : "";
    const text = `**${q.title}**${priority} - ${q.description} _(${sources})_ \`id:${q.id}\``;
    listItems.push({
      type: "listItem",
      checked,
      children: [{ type: "paragraph", children: parseMarkdownLine(text) }],
    });
  }

  for (const q of answered) {
    const text = `~~${q.title}~~ - ${q.answer_summary} \`id:${q.id}\``;
    listItems.push({
      type: "listItem",
      checked: true,
      children: [{ type: "paragraph", children: parseMarkdownLine(text) }],
    });
  }

  for (const q of existingQuestions) {
    if (q.id && !newIds.has(q.id)) {
      listItems.push({
        type: "listItem",
        checked: q.checked,
        children: [{ type: "paragraph", children: parseMarkdownLine(q.text) }],
      });
    }
  }

  const list: List = {
    type: "list",
    ordered: false,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- unknown[] contains valid ListItem nodes
    children: listItems as List["children"],
  };

  return [list];
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function runGroomingSummary(
  issueNumber: number,
  groomingOutput: CombinedGroomingOutput,
  data: {
    issue: { title: string; bodyAst: Root; comments: Array<{ body: string }> };
  },
  previousQuestions?: string,
): Promise<GroomingSummaryOutput> {
  const resolved = resolvePrompt({
    promptDir: "grooming/summary",
    promptVars: {
      ISSUE_NUMBER: String(issueNumber),
      ISSUE_TITLE: data.issue.title,
      ISSUE_BODY: JSON.stringify(data.issue.bodyAst),
      ISSUE_COMMENTS: data.issue.comments.map((c) => c.body).join("\n---\n"),
      PM_OUTPUT: JSON.stringify(groomingOutput.pm),
      ENGINEER_OUTPUT: JSON.stringify(groomingOutput.engineer),
      QA_OUTPUT: JSON.stringify(groomingOutput.qa),
      RESEARCH_OUTPUT: JSON.stringify(groomingOutput.research),
      ...(previousQuestions ? { PREVIOUS_QUESTIONS: previousQuestions } : {}),
    },
  });

  core.startGroup("Grooming Summary");
  const result = await executeClaudeSDK({
    prompt: resolved.prompt,
    cwd: process.cwd(),
    outputSchema: resolved.outputSchema,
  });
  core.endGroup();

  if (!result.success || !result.structuredOutput) {
    core.warning(
      `Grooming summary failed: ${result.error || "no structured output"}`,
    );
    return buildFallbackSummary(groomingOutput);
  }

  return parseOutput(
    GroomingSummaryOutputSchema,
    result.structuredOutput,
    "grooming summary",
  );
}

async function createAllPhases(
  ctx: RunnerContext,
  parentIssueNumber: number,
  phases: SubIssueSpec[],
): Promise<number> {
  let created = 0;

  for (const phase of phases) {
    const title = `[Phase ${phase.phase_number}]: ${phase.title}`;
    const body = buildPhaseIssueBody(phase);

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

  if (created > 0) {
    try {
      const { data: parentData, update: parentUpdate } = await parseIssue(
        ctx.owner,
        ctx.repo,
        parentIssueNumber,
        {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible octokit type
          octokit: ctx.octokit as Parameters<typeof parseIssue>[3]["octokit"],
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

// ============================================================================
// Grooming Actions
// ============================================================================

export const groomingActions = {
  /** Apply grooming output — AI-dependent, produces 3 possible outcomes */
  applyGroomingOutput: defAction(
    mkSchema("applyGroomingOutput", {
      issueNumber: z.number().int().positive(),
      filePath: z.string().optional(),
    }),
    {
      predict: () => [
        { target: { labels: { add: ["groomed"] } } },
        { target: { labels: { add: ["needs-info"] } } },
        { target: { projectStatus: "Blocked" } },
      ],
      execute: async (action, ctx, chainCtx) => {
        const structuredOutput = getStructuredOutput(action, chainCtx);
        let groomingOutput: CombinedGroomingOutput;

        if (structuredOutput) {
          groomingOutput = parseOutput(
            CombinedGroomingOutputSchema,
            structuredOutput,
            "grooming",
          );
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          const content = fs.readFileSync(action.filePath, "utf-8");
          groomingOutput = parseOutput(
            CombinedGroomingOutputSchema,
            JSON.parse(content),
            "grooming file",
          );
          core.info(`Grooming output from file: ${action.filePath}`);
        } else {
          throw new Error(
            `No structured output provided and file not found at: ${action.filePath}`,
          );
        }

        core.info(`Applying grooming output for issue #${action.issueNumber}`);
        core.startGroup("Grooming Output");
        core.info(JSON.stringify(groomingOutput, null, 2));
        core.endGroup();

        if (ctx.dryRun) {
          core.info(`[DRY RUN] Would apply grooming output`);
          return { applied: true, decision: "ready" };
        }

        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          {
            octokit: asOctokitLike(ctx),
            fetchPRs: false,
            fetchParent: false,
          },
        );

        const allAgentsReady =
          groomingOutput.pm.ready &&
          groomingOutput.engineer.ready &&
          groomingOutput.qa.ready &&
          groomingOutput.research.ready;

        const existingQuestions = extractQuestionItems(data.issue.bodyAst);

        const previousQuestionsText =
          existingQuestions.length > 0
            ? existingQuestions
                .map((q) => `- [${q.checked ? "x" : " "}] ${q.text}`)
                .join("\n")
            : undefined;

        const summaryOutput = await runGroomingSummary(
          action.issueNumber,
          groomingOutput,
          data,
          previousQuestionsText,
        );

        const content = buildQuestionsContent(summaryOutput, existingQuestions);

        // Count questions that are still unanswered after the summary.
        // A question is unanswered if it's in consolidated_questions AND
        // was not already checked by the user in the issue body.
        const answeredIds = new Set(
          (summaryOutput.answered_questions ?? []).map((q) => q.id),
        );
        const userCheckedIds = new Set(
          existingQuestions.filter((q) => q.checked).map((q) => q.id),
        );
        const unansweredCount = (
          summaryOutput.consolidated_questions ?? []
        ).filter(
          (q) => !answeredIds.has(q.id) && !userCheckedIds.has(q.id),
        ).length;

        // Decision: agents must all be ready AND no unanswered questions
        const decision =
          allAgentsReady && unansweredCount === 0 ? "ready" : "needs_info";
        core.info(
          `Grooming decision: ${decision} (agents=${allAgentsReady}, unanswered=${unansweredCount})`,
        );

        if (content.length > 0) {
          let updatedData = upsertSection(
            { title: "Questions", content },
            data,
          );

          const questionCount = (summaryOutput.consolidated_questions ?? [])
            .length;
          const answeredCount = (summaryOutput.answered_questions ?? []).length;
          const notes = [
            `Grooming decision: ${decision}`,
            `Summary: ${questionCount} pending question(s), ${answeredCount} answered, ${unansweredCount} unanswered`,
            summaryOutput.decision_rationale,
          ];
          updatedData = appendAgentNotes(
            {
              runId: `grooming-${Date.now()}`,
              runLink: "",
              notes,
            },
            updatedData,
          );

          await update(updatedData);
          core.info(
            `Updated Questions section and agent notes in issue #${action.issueNumber} body`,
          );
        }

        if (decision === "ready") {
          const { data: readyData, update: readyUpdate } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit: asOctokitLike(ctx),
              fetchPRs: false,
              fetchParent: false,
            },
          );

          try {
            await readyUpdate({
              ...readyData,
              issue: {
                ...readyData.issue,
                labels: [...readyData.issue.labels, "groomed"],
              },
            });
            core.info(`Added 'groomed' label to issue #${action.issueNumber}`);
          } catch (error) {
            core.warning(`Failed to add 'groomed' label: ${error}`);
          }

          const engineerOutput = parseOutput(
            EngineerOutputSchema,
            groomingOutput.engineer,
            "engineer",
          );

          return {
            applied: true,
            decision,
            recommendedPhases: engineerOutput.recommended_phases,
          };
        }

        // Add needs-info label for needs_info decision
        try {
          const { data: infoData, update: infoUpdate } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit: asOctokitLike(ctx),
              fetchPRs: false,
              fetchParent: false,
            },
          );
          await infoUpdate({
            ...infoData,
            issue: {
              ...infoData.issue,
              labels: [...infoData.issue.labels, "needs-info"],
            },
          });
          core.info(`Added 'needs-info' label to issue #${action.issueNumber}`);
        } catch (error) {
          core.warning(`Failed to add 'needs-info' label: ${error}`);
        }

        return { applied: true, decision };
      },
    },
  ),

  /** Reconcile sub-issues using AI-driven semantic matching */
  reconcileSubIssues: defAction(
    mkSchema("reconcileSubIssues", {
      issueNumber: z.number().int().positive(),
    }),
    {
      execute: async (action, ctx, chainCtx) => {
        const structuredOutput = getStructuredOutput(action, chainCtx);
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

        const { data } = await parseIssue(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          {
            octokit: asOctokitLike(ctx),
            fetchPRs: true,
            fetchParent: false,
          },
        );

        const existingSubIssues = extractSubIssueSpecs(data.issue.subIssues);

        // Simple path: no existing sub-issues
        if (existingSubIssues.length === 0) {
          core.info(
            `No existing sub-issues, creating ${recommendedPhases.length} phases directly`,
          );
          const created = await createAllPhases(
            ctx,
            action.issueNumber,
            recommendedPhases,
          );
          return { reconciled: true, created, updated: 0, deleted: 0 };
        }

        // Reconciliation path
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
            `Reconciliation prompt failed: ${result.error || "no structured output"}. Falling back to creating missing phases.`,
          );
          const existingPhaseNumbers = new Set(
            existingSubIssues.map((s) => s.phase_number).filter((n) => n > 0),
          );
          const missingPhases = recommendedPhases.filter(
            (p) => !existingPhaseNumbers.has(p.phase_number),
          );
          if (missingPhases.length === 0) {
            core.info(
              "All recommended phases already have existing counterparts, skipping fallback creation",
            );
            return { reconciled: true, created: 0, updated: 0, deleted: 0 };
          }
          core.info(
            `Creating ${missingPhases.length} missing phases (${recommendedPhases.length - missingPhases.length} already exist)`,
          );
          const created = await createAllPhases(
            ctx,
            action.issueNumber,
            missingPhases,
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
              },
            );

            core.info(
              `Created sub-issue #${createResult.issueNumber}: ${title}`,
            );
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
            const existingSub = existingSubIssues.find(
              (s) => s.number === spec.number,
            );

            if (existingSub?.merged) {
              core.info(
                `Skipping completed phase #${spec.number} (merged PR, reason: ${spec.match_reason})`,
              );
              continue;
            }

            if (existingSub?.state === "CLOSED" && !existingSub.merged) {
              core.info(
                `Superseding abandoned sub-issue #${spec.number}, creating fresh replacement`,
              );

              await ctx.octokit.rest.issues.addLabels({
                owner: ctx.owner,
                repo: ctx.repo,
                issue_number: spec.number,
                labels: ["superseded"],
              });

              const body = buildPhaseIssueBody(spec);
              const title = `[Phase ${spec.phase_number}]: ${spec.title}`;

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
                },
              );

              core.info(
                `Superseded #${spec.number}, created fresh #${createResult.issueNumber}: ${title}`,
              );
              created++;
              continue;
            }

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

            const existingTodos = extractExistingTodos(subData.issue.bodyAst);
            const mergedTodos = mergeTodos(spec.todos ?? [], existingTodos);

            const newBody = buildPhaseIssueBody({
              ...spec,
              todos: mergedTodos.map((t) => ({
                task: t.text,
                manual: t.manual,
              })),
            });

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
            await ctx.octokit.rest.issues.addLabels({
              owner: ctx.owner,
              repo: ctx.repo,
              issue_number: entry.number,
              labels: ["superseded"],
            });

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
      },
    },
  ),
};
