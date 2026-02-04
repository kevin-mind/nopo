import * as core from "@actions/core";
import * as fs from "fs";
import type {
  RunClaudeGroomingAction,
  ApplyGroomingOutputAction,
  GroomingAgentType,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { executeRunClaude } from "./claude.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Output from a single grooming agent
 */
interface GroomingAgentOutput {
  ready: boolean;
  questions?: string[];
  [key: string]: unknown;
}

/**
 * Combined output from all grooming agents
 */
interface CombinedGroomingOutput {
  pm: GroomingAgentOutput;
  engineer: GroomingAgentOutput;
  qa: GroomingAgentOutput;
  research: GroomingAgentOutput;
}

/**
 * Summary agent decision
 */
interface GroomingSummaryOutput {
  summary: string;
  decision: "ready" | "needs_info" | "blocked";
  decision_rationale: string;
  questions?: Array<{
    question: string;
    source: GroomingAgentType;
    priority: "critical" | "important" | "nice-to-have";
  }>;
  blocker_reason?: string;
  next_steps?: string[];
  agent_notes?: string[];
}

// ============================================================================
// Main Executors
// ============================================================================

/**
 * Execute runClaudeGrooming action
 *
 * Runs all 4 grooming agents (PM, Engineer, QA, Research) in parallel,
 * collects their outputs, and writes them to grooming-output.json
 */
export async function executeRunClaudeGrooming(
  action: RunClaudeGroomingAction,
  ctx: RunnerContext,
): Promise<{ outputs: CombinedGroomingOutput }> {
  const { issueNumber, promptVars } = action;

  core.info(`Running grooming agents for issue #${issueNumber}`);

  if (ctx.dryRun) {
    core.info("[DRY RUN] Would run 4 grooming agents in parallel");
    const mockOutput: CombinedGroomingOutput = {
      pm: { ready: true },
      engineer: { ready: true },
      qa: { ready: true },
      research: { ready: true },
    };
    return { outputs: mockOutput };
  }

  // Define the 4 grooming agents
  const agents: GroomingAgentType[] = ["pm", "engineer", "qa", "research"];

  // Run all agents in parallel
  const results = await Promise.all(
    agents.map(async (agent) => {
      core.info(`Starting grooming agent: ${agent}`);
      try {
        const result = await executeRunClaude(
          {
            type: "runClaude",
            token: "code",
            promptDir: `grooming/${agent}`,
            promptsDir: ".github/statemachine/issue/prompts",
            promptVars,
            issueNumber,
            worktree: "main", // Grooming runs from main
          },
          ctx,
        );
        core.info(`Grooming agent ${agent} completed`);
        return { agent, output: result.structuredOutput as GroomingAgentOutput };
      } catch (error) {
        core.warning(`Grooming agent ${agent} failed: ${error}`);
        // Return a default "not ready" output on failure
        return {
          agent,
          output: {
            ready: false,
            questions: [`Grooming agent ${agent} failed to run`],
          } as GroomingAgentOutput,
        };
      }
    }),
  );

  // Combine outputs
  const outputs: CombinedGroomingOutput = {
    pm: { ready: true },
    engineer: { ready: true },
    qa: { ready: true },
    research: { ready: true },
  };

  for (const { agent, output } of results) {
    outputs[agent] = output || { ready: false };
  }

  // Write combined output to file for artifact
  const outputPath = "grooming-output.json";
  fs.writeFileSync(outputPath, JSON.stringify(outputs, null, 2));
  core.info(`Wrote combined grooming output to ${outputPath}`);

  return { outputs };
}

/**
 * Execute applyGroomingOutput action
 *
 * Runs the summary agent to synthesize all grooming agent outputs,
 * then applies the decision:
 * - ready: add "groomed" label, set status to Ready
 * - needs_info: add "needs-info" label, post questions as comment
 * - blocked: set status to Blocked, post blocker reason as comment
 */
export async function executeApplyGroomingOutput(
  action: ApplyGroomingOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; decision?: string }> {
  const { issueNumber, filePath } = action;

  let groomingOutputs: CombinedGroomingOutput;

  // Try structured output first, then fall back to file
  if (structuredOutput) {
    groomingOutputs = structuredOutput as CombinedGroomingOutput;
    core.info("Using grooming output from in-process chain");
  } else if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      groomingOutputs = JSON.parse(content) as CombinedGroomingOutput;
      core.info(`Grooming output from file: ${filePath}`);
    } catch (error) {
      core.warning(`Failed to parse grooming output: ${error}`);
      return { applied: false };
    }
  } else {
    throw new Error(
      `No structured output provided and grooming output file not found at: ${filePath || "undefined"}`,
    );
  }

  core.startGroup("Grooming Outputs");
  core.info(JSON.stringify(groomingOutputs, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply grooming output to issue #${issueNumber}`);
    return { applied: true, decision: "ready" };
  }

  // Run summary agent to synthesize outputs and make decision
  const summaryPromptVars: Record<string, string> = {
    PM_OUTPUT: JSON.stringify(groomingOutputs.pm, null, 2),
    ENGINEER_OUTPUT: JSON.stringify(groomingOutputs.engineer, null, 2),
    QA_OUTPUT: JSON.stringify(groomingOutputs.qa, null, 2),
    RESEARCH_OUTPUT: JSON.stringify(groomingOutputs.research, null, 2),
  };

  let summaryOutput: GroomingSummaryOutput;
  try {
    const summaryResult = await executeRunClaude(
      {
        type: "runClaude",
        token: "code",
        promptDir: "grooming/summary",
        promptsDir: ".github/statemachine/issue/prompts",
        promptVars: summaryPromptVars,
        issueNumber,
        worktree: "main",
      },
      ctx,
    );

    // Validate that we got a valid structured output
    if (
      !summaryResult.structuredOutput ||
      typeof (summaryResult.structuredOutput as GroomingSummaryOutput)
        .decision !== "string"
    ) {
      throw new Error(
        "Summary agent did not return valid structured output with decision field",
      );
    }
    summaryOutput = summaryResult.structuredOutput as GroomingSummaryOutput;
  } catch (error) {
    core.error(`Summary agent failed: ${error}`);
    // Default to needs_info on summary failure
    summaryOutput = {
      summary: "Summary agent failed to run",
      decision: "needs_info",
      decision_rationale: `Summary agent error: ${error}`,
      questions: [{ question: "Please retry grooming", source: "pm", priority: "critical" }],
    };
  }

  core.info(`Grooming decision: ${summaryOutput.decision}`);
  core.info(`Rationale: ${summaryOutput.decision_rationale}`);

  // Apply the decision
  await applyGroomingDecision(ctx, issueNumber, summaryOutput);

  return { applied: true, decision: summaryOutput.decision };
}

// ============================================================================
// Decision Application
// ============================================================================

/**
 * Apply the grooming decision to the issue
 */
async function applyGroomingDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
): Promise<void> {
  switch (summary.decision) {
    case "ready":
      await applyReadyDecision(ctx, issueNumber, summary);
      break;
    case "needs_info":
      await applyNeedsInfoDecision(ctx, issueNumber, summary);
      break;
    case "blocked":
      await applyBlockedDecision(ctx, issueNumber, summary);
      break;
    default:
      core.warning(`Unknown grooming decision: ${summary.decision}`);
  }
}

/**
 * Apply "ready" decision - issue is ready for implementation
 */
async function applyReadyDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
): Promise<void> {
  // Add "groomed" label
  try {
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: ["groomed"],
    });
    core.info('Added "groomed" label');
  } catch (error) {
    core.warning(`Failed to add groomed label: ${error}`);
  }

  // Post summary as comment
  try {
    const body = formatReadyComment(summary);
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
    core.info("Posted grooming summary comment");
  } catch (error) {
    core.warning(`Failed to post grooming comment: ${error}`);
  }
}

/**
 * Apply "needs_info" decision - issue needs clarification
 */
async function applyNeedsInfoDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
): Promise<void> {
  // Add "needs-info" label
  try {
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: ["needs-info"],
    });
    core.info('Added "needs-info" label');
  } catch (error) {
    core.warning(`Failed to add needs-info label: ${error}`);
  }

  // Post questions as comment
  try {
    const body = formatNeedsInfoComment(summary);
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
    core.info("Posted needs-info questions comment");
  } catch (error) {
    core.warning(`Failed to post needs-info comment: ${error}`);
  }
}

/**
 * Apply "blocked" decision - issue cannot proceed
 */
async function applyBlockedDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
): Promise<void> {
  // Add "blocked" label
  try {
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: ["blocked"],
    });
    core.info('Added "blocked" label');
  } catch (error) {
    core.warning(`Failed to add blocked label: ${error}`);
  }

  // Post blocker reason as comment
  try {
    const body = formatBlockedComment(summary);
    await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body,
    });
    core.info("Posted blocked reason comment");
  } catch (error) {
    core.warning(`Failed to post blocked comment: ${error}`);
  }
}

// ============================================================================
// Comment Formatting
// ============================================================================

/**
 * Format comment for "ready" decision
 */
function formatReadyComment(summary: GroomingSummaryOutput): string {
  let comment = `## Grooming Complete

${summary.summary}

**Decision**: Ready for implementation

${summary.decision_rationale}`;

  if (summary.next_steps && summary.next_steps.length > 0) {
    comment += `\n\n### Next Steps\n${summary.next_steps.map((s) => `- ${s}`).join("\n")}`;
  }

  comment += `\n\n---\n*Generated by grooming automation*`;
  return comment;
}

/**
 * Format comment for "needs_info" decision
 */
function formatNeedsInfoComment(summary: GroomingSummaryOutput): string {
  let comment = `## Grooming: Questions Needed

${summary.summary}

**Decision**: Needs more information before work can begin

${summary.decision_rationale}

### Questions`;

  if (summary.questions && summary.questions.length > 0) {
    // Group by priority
    const critical = summary.questions.filter((q) => q.priority === "critical");
    const important = summary.questions.filter((q) => q.priority === "important");
    const niceToHave = summary.questions.filter((q) => q.priority === "nice-to-have");

    if (critical.length > 0) {
      comment += `\n\n**Critical** (must answer before proceeding):\n${critical.map((q) => `- [ ] ${q.question} *(from ${q.source})*`).join("\n")}`;
    }
    if (important.length > 0) {
      comment += `\n\n**Important**:\n${important.map((q) => `- [ ] ${q.question} *(from ${q.source})*`).join("\n")}`;
    }
    if (niceToHave.length > 0) {
      comment += `\n\n**Nice to have**:\n${niceToHave.map((q) => `- [ ] ${q.question} *(from ${q.source})*`).join("\n")}`;
    }
  }

  comment += `\n\n---\nPlease answer the questions above and remove the \`needs-info\` label to re-trigger grooming.\n\n*Generated by grooming automation*`;
  return comment;
}

/**
 * Format comment for "blocked" decision
 */
function formatBlockedComment(summary: GroomingSummaryOutput): string {
  let comment = `## Grooming: Blocked

${summary.summary}

**Decision**: Cannot proceed with this issue

${summary.decision_rationale}`;

  if (summary.blocker_reason) {
    comment += `\n\n### Blocker\n${summary.blocker_reason}`;
  }

  if (summary.next_steps && summary.next_steps.length > 0) {
    comment += `\n\n### To Unblock\n${summary.next_steps.map((s) => `- ${s}`).join("\n")}`;
  }

  comment += `\n\n---\n*Generated by grooming automation*`;
  return comment;
}
