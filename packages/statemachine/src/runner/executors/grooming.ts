/**
 * Grooming Executors
 *
 * Executors for running parallel grooming agents and applying their outputs.
 */

import * as core from "@actions/core";
import * as fs from "fs";
import type { Root, RootContent, List } from "mdast";
import { parseIssue, parseMarkdown, type OctokitLike } from "@more/issue-state";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import type {
  RunClaudeGroomingAction,
  ApplyGroomingOutputAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import {
  appendAgentNotes,
  upsertSection,
  extractQuestionsFromAst,
  extractQuestionItems,
  type QuestionItem,
} from "../../parser/index.js";
import {
  CombinedGroomingOutputSchema,
  EngineerOutputSchema,
  GroomingSummaryOutputSchema,
  parseOutput,
  type CombinedGroomingOutput,
  type GroomingSummaryOutput,
  type SubIssueSpec,
} from "./output-schemas.js";

// Helper to cast RunnerContext octokit to OctokitLike

function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
}

// ============================================================================
// Run Claude Grooming
// ============================================================================

/**
 * Run a single grooming agent via Claude SDK
 */
async function runGroomingAgent(
  agentName: string,
  promptVars: Record<string, string>,
): Promise<unknown> {
  core.info(`Starting grooming agent: ${agentName}`);

  const resolved = resolvePrompt({
    promptDir: `grooming/${agentName}`,
    promptVars,
  });

  core.startGroup(`Grooming Agent: ${agentName}`);
  const result = await executeClaudeSDK({
    prompt: resolved.prompt,
    cwd: process.cwd(),
    outputSchema: resolved.outputSchema,
  });
  core.endGroup();

  if (!result.success || !result.structuredOutput) {
    core.warning(
      `Grooming agent ${agentName} failed: ${result.error || "no structured output"}`,
    );
    return {
      ready: false,
      questions: [`Agent ${agentName} failed to complete analysis`],
    };
  }

  core.info(
    `Grooming agent ${agentName} completed (${result.numTurns} turns, $${result.costUsd?.toFixed(4) ?? "?"})`,
  );
  return result.structuredOutput;
}

/**
 * Run Claude grooming agents in parallel
 * Executes PM, Engineer, QA, and Research agents and collects their outputs.
 */
export async function executeRunClaudeGrooming(
  action: RunClaudeGroomingAction,
  ctx: RunnerContext,
): Promise<{ outputs: CombinedGroomingOutput }> {
  core.info(`Running grooming agents for issue #${action.issueNumber}`);

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would run 4 grooming agents in parallel`);
    return {
      outputs: {
        pm: { ready: true },
        engineer: { ready: true },
        qa: { ready: true },
        research: { ready: true },
      },
    };
  }

  // Check for mock outputs
  if (ctx.mockOutputs?.grooming) {
    core.info("[MOCK MODE] Using mock grooming output");
    return {
      outputs: parseOutput(
        CombinedGroomingOutputSchema,
        ctx.mockOutputs.grooming,
        "mock grooming",
      ),
    };
  }

  const promptVars = action.promptVars ?? {};

  // Run all 4 grooming agents in parallel
  const [pmResult, engineerResult, qaResult, researchResult] =
    await Promise.all([
      runGroomingAgent("pm", promptVars),
      runGroomingAgent("engineer", promptVars),
      runGroomingAgent("qa", promptVars),
      runGroomingAgent("research", promptVars),
    ]);

  const outputs = parseOutput(
    CombinedGroomingOutputSchema,
    {
      pm: pmResult,
      engineer: engineerResult,
      qa: qaResult,
      research: researchResult,
    },
    "combined grooming",
  );

  core.info("All grooming agents completed");
  return { outputs };
}

// ============================================================================
// Apply Grooming Output
// ============================================================================

/**
 * Apply grooming output from the grooming agents
 * Runs the summary agent and applies the decision (ready, needs_info, blocked).
 * Creates sub-issues if engineer recommends splitting into phases.
 */
export async function executeApplyGroomingOutput(
  action: ApplyGroomingOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{
  applied: boolean;
  decision: string;
  recommendedPhases?: SubIssueSpec[];
}> {
  let groomingOutput: CombinedGroomingOutput;

  // Try structured output first, then fall back to file
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

  // Parse issue data first (needed for readiness check and both branches)
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

  // Decision is based on agent readiness. Agents have full context (body +
  // comments) and their determination is authoritative. Body question
  // checkboxes are tracking state that may be stale (e.g. triage questions
  // answered in comments but never checked off).
  const allAgentsReady =
    groomingOutput.pm.ready &&
    groomingOutput.engineer.ready &&
    groomingOutput.qa.ready &&
    groomingOutput.research.ready;

  const questionStats = extractQuestionsFromAst(data.issue.bodyAst);
  const decision = allAgentsReady ? "ready" : "needs_info";
  core.info(
    `Grooming decision: ${decision} (agents=${allAgentsReady}, bodyQuestions=${questionStats.unanswered} unanswered)`,
  );

  // Always run the summary to consolidate questions and update the body,
  // regardless of the decision. This keeps the Questions section current.
  const existingQuestions = extractQuestionItems(data.issue.bodyAst);

  const previousQuestionsText =
    existingQuestions.length > 0
      ? existingQuestions
          .map((q) => `- [${q.checked ? "x" : " "}] ${q.text}`)
          .join("\n")
      : undefined;

  const summaryOutput = await runGroomingSummary(
    action,
    groomingOutput,
    data,
    previousQuestionsText,
  );

  // Update the Questions section in the body
  const content = buildQuestionsContent(summaryOutput, existingQuestions);

  if (content.length > 0) {
    let updatedData = upsertSection({ title: "Questions", content }, data);

    const questionCount = (summaryOutput.consolidated_questions ?? []).length;
    const answeredCount = (summaryOutput.answered_questions ?? []).length;
    const notes = [
      `Grooming decision: ${decision}`,
      `Summary: ${questionCount} pending question(s), ${answeredCount} answered`,
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
    // Re-parse to get fresh state after body update above
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

    // Add 'groomed' label
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

    // Extract recommended phases to pass forward to reconcileSubIssues action
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

  return { applied: true, decision };
}

// ============================================================================
// Grooming Summary
// ============================================================================

/**
 * Run the grooming summary prompt to consolidate questions from all agents.
 */
async function runGroomingSummary(
  action: ApplyGroomingOutputAction,
  groomingOutput: CombinedGroomingOutput,
  data: {
    issue: { title: string; bodyAst: Root; comments: Array<{ body: string }> };
  },
  previousQuestions?: string,
): Promise<GroomingSummaryOutput> {
  const resolved = resolvePrompt({
    promptDir: "grooming/summary",
    promptVars: {
      ISSUE_NUMBER: String(action.issueNumber),
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
    // Fall back to basic question collection from agents
    return buildFallbackSummary(groomingOutput);
  }

  return parseOutput(
    GroomingSummaryOutputSchema,
    result.structuredOutput,
    "grooming summary",
  );
}

/**
 * Build a fallback summary when the summary prompt fails.
 * Collects raw questions from agents as consolidated questions.
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
 * This preserves rich formatting (bold, strikethrough, inline code) in the AST
 * instead of creating plain text nodes that get escaped on serialization.
 */
function parseMarkdownLine(markdown: string): RootContent[] {
  const ast = parseMarkdown(markdown);
  const firstChild = ast.children[0];
  if (firstChild && "children" in firstChild) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- paragraph children are phrasing content, compatible with RootContent
    return (firstChild as { children: RootContent[] }).children;
  }
  return [{ type: "text", value: markdown }];
}

/**
 * Build questions content as MDAST RootContent[] for upsertSection.
 * Merges new consolidated questions with existing ones from the body.
 *
 * - New pending questions → unchecked, with `id:slug` inline code
 * - Answered questions → checked with strikethrough, with `id:slug` inline code
 * - Existing triage questions (no ID) → dropped when summary has answered/pending
 *   versions (the summary supersedes them)
 * - Existing grooming questions not in new output → preserved with current checked state
 * - User-checked questions → respected (not unchecked by re-run)
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

  // Build a set of IDs from the new output (pending + answered)
  const newIds = new Set<string>();
  for (const q of pending) newIds.add(q.id);
  for (const q of answered) newIds.add(q.id);

  // Build a map of existing questions by ID for user-checked state
  const existingById = new Map<string, QuestionItem>();
  for (const q of existingQuestions) {
    if (q.id) existingById.set(q.id, q);
  }

  // When the summary has output, triage questions (no ID) are superseded —
  // the summary consolidates and re-identifies them with proper IDs.
  const hasSummaryOutput = pending.length > 0 || answered.length > 0;

  // Build list items as MDAST nodes with proper formatting
  const listItems: unknown[] = [];

  // 1. Preserve existing triage questions (no ID) only if summary has no output
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

  // 2. Add pending questions (unchecked, unless user already checked them)
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

  // 3. Add answered questions (checked with strikethrough)
  for (const q of answered) {
    const text = `~~${q.title}~~ - ${q.answer_summary} \`id:${q.id}\``;
    listItems.push({
      type: "listItem",
      checked: true,
      children: [{ type: "paragraph", children: parseMarkdownLine(text) }],
    });
  }

  // 4. Preserve existing grooming questions not in new output
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
