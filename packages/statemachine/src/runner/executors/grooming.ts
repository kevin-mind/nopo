/**
 * Grooming Executors
 *
 * Executors for running parallel grooming agents and applying their outputs.
 */

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
  type OctokitLike,
  type ProjectStatus,
} from "@more/issue-state";
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
  type RecommendedPhase,
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
): Promise<{ applied: boolean; decision: string; subIssuesCreated?: number }> {
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

  // Determine the decision based on agent readiness AND question state
  const allAgentsReady =
    groomingOutput.pm.ready &&
    groomingOutput.engineer.ready &&
    groomingOutput.qa.ready &&
    groomingOutput.research.ready;

  const questionStats = extractQuestionsFromAst(data.issue.bodyAst);
  const allReady = allAgentsReady && questionStats.unanswered === 0;

  const decision = allReady ? "ready" : "needs_info";
  core.info(
    `Grooming decision: ${decision} (agents=${allAgentsReady}, questions=${questionStats.unanswered} unanswered)`,
  );

  // Track sub-issues created
  let subIssuesCreated = 0;

  // Apply the decision
  if (decision === "ready") {
    // Add 'groomed' label to indicate issue is ready for implementation
    try {
      await update({
        ...data,
        issue: {
          ...data.issue,
          labels: [...data.issue.labels, "groomed"],
        },
      });
      core.info(`Added 'groomed' label to issue #${action.issueNumber}`);
    } catch (error) {
      core.warning(`Failed to add 'groomed' label: ${error}`);
    }

    // Create sub-issues from engineer's recommended phases
    // Phases are always required - work happens on sub-issues, not parent issues
    const engineerOutput = parseOutput(
      EngineerOutputSchema,
      groomingOutput.engineer,
      "engineer",
    );
    core.info(
      `Creating ${engineerOutput.recommended_phases.length} sub-issues`,
    );
    subIssuesCreated = await createSubIssuesForPhases(
      ctx,
      action.issueNumber,
      engineerOutput.recommended_phases,
    );
  } else {
    // Extract existing questions from body for context
    const existingQuestions = extractQuestionItems(data.issue.bodyAst);

    // Build previous questions text for summary prompt context
    const previousQuestionsText =
      existingQuestions.length > 0
        ? existingQuestions
            .map((q) => `- [${q.checked ? "x" : " "}] ${q.text}`)
            .join("\n")
        : undefined;

    // Run summary prompt with consolidated question logic
    const summaryOutput = await runGroomingSummary(
      action,
      groomingOutput,
      data,
      previousQuestionsText,
    );

    // Build questions content as MDAST and upsert into body
    const content = buildQuestionsContent(summaryOutput, existingQuestions);

    if (content.length > 0) {
      let updatedData = upsertSection({ title: "Questions", content }, data);

      // Log agent notes for the grooming decision
      const questionCount = (summaryOutput.consolidated_questions ?? []).length;
      const answeredCount = (summaryOutput.answered_questions ?? []).length;
      const notes = [
        `Grooming decision: needs_info`,
        `${questionCount} pending question(s), ${answeredCount} answered`,
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
  }

  return { applied: true, decision, subIssuesCreated };
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
 * - Existing triage questions (no ID) → preserved as-is
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

  // Build list items as MDAST nodes with proper formatting
  const listItems: unknown[] = [];

  // 1. Preserve existing triage questions (no ID) as-is
  for (const q of existingQuestions) {
    if (!q.id) {
      listItems.push({
        type: "listItem",
        checked: q.checked,
        children: [{ type: "paragraph", children: parseMarkdownLine(q.text) }],
      });
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

// ============================================================================
// Sub-Issue Creation
// ============================================================================

/**
 * Create sub-issues for each recommended phase using issue-state
 */
async function createSubIssuesForPhases(
  ctx: RunnerContext,
  parentIssueNumber: number,
  phases: RecommendedPhase[],
): Promise<number> {
  let created = 0;

  for (const phase of phases) {
    const title = `[Phase ${phase.phase_number}]: ${phase.title}`;
    const body = buildPhaseIssueBody(phase);

    // Set project status for first phase to "Ready", others to null (no status)
    const projectStatus: ProjectStatus | undefined =
      phase.phase_number === 1 ? "Ready" : undefined;

    try {
      // Use issue-state's addSubIssueToParent to create and link the sub-issue
      // Cast octokit to handle type differences between @actions/github and OctokitLike
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

      if (phase.phase_number === 1 && projectStatus) {
        core.info(
          `Set Phase 1 sub-issue #${result.issueNumber} to ${projectStatus} status`,
        );
      }
    } catch (error) {
      core.error(
        `Failed to create sub-issue for phase ${phase.phase_number}: ${error}`,
      );
    }
  }

  // Update parent issue body with agent notes about sub-issue creation
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
          runId: `grooming-${Date.now()}`,
          runLink: "",
          notes: [
            "Grooming complete. Sub-issues created for phased implementation.",
          ],
        },
        parentData,
      );

      if (parentState !== parentData) {
        await parentUpdate(parentState);
      }
      core.info(`Updated parent issue #${parentIssueNumber} with agent notes`);
    } catch (error) {
      core.warning(`Failed to update parent issue body: ${error}`);
    }
  }

  return created;
}

/**
 * Build the body for a phase sub-issue as MDAST
 */
function buildPhaseIssueBody(phase: RecommendedPhase): Root {
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
