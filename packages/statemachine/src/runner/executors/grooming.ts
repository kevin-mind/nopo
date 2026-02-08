/**
 * Grooming Executors
 *
 * Executors for running parallel grooming agents and applying their outputs.
 */

import * as core from "@actions/core";
import * as fs from "fs";
import type { Root } from "mdast";
import {
  addSubIssueToParent,
  createSection,
  createParagraph,
  createBulletList,
  createTodoList,
  type ProjectStatus,
  type TodoItem,
} from "@more/issue-state";
import type {
  RunClaudeGroomingAction,
  ApplyGroomingOutputAction,
  GroomingAgentType,
} from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";

// ============================================================================
// Types
// ============================================================================

interface GroomingAgentOutput {
  ready: boolean;
  questions?: string[];
  [key: string]: unknown;
}

interface AffectedArea {
  path: string;
  change_type?: string;
  description?: string;
  impact?: string;
}

interface TodoItem {
  task: string;
  manual?: boolean;
}

interface RecommendedPhase {
  phase_number: number;
  title: string;
  description: string;
  affected_areas?: AffectedArea[];
  todos?: TodoItem[];
  depends_on?: number[];
}

interface EngineerOutput extends GroomingAgentOutput {
  scope_recommendation?: "direct" | "split";
  recommended_phases?: RecommendedPhase[];
}

interface CombinedGroomingOutput {
  pm: GroomingAgentOutput;
  engineer: GroomingAgentOutput;
  qa: GroomingAgentOutput;
  research: GroomingAgentOutput;
}

interface _GroomingSummaryOutput {
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
// Run Claude Grooming
// ============================================================================

/**
 * Run Claude grooming agents in parallel
 * Executes PM, Engineer, QA, and Research agents and collects their outputs.
 *
 * TODO: Full implementation with parallel Claude calls
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
      outputs: ctx.mockOutputs.grooming as unknown as CombinedGroomingOutput,
    };
  }

  // TODO: Run 4 Claude agents in parallel (PM, Engineer, QA, Research)
  // For now, return placeholder outputs
  const outputs: CombinedGroomingOutput = {
    pm: { ready: true, questions: [] },
    engineer: { ready: true, questions: [] },
    qa: { ready: true, questions: [] },
    research: { ready: true, questions: [] },
  };

  core.info("Grooming agents completed (placeholder implementation)");
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
    groomingOutput = structuredOutput as CombinedGroomingOutput;
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
    groomingOutput = JSON.parse(content) as CombinedGroomingOutput;
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

  // Determine the decision based on agent readiness
  const allReady =
    groomingOutput.pm.ready &&
    groomingOutput.engineer.ready &&
    groomingOutput.qa.ready &&
    groomingOutput.research.ready;

  const decision = allReady ? "ready" : "needs_info";
  core.info(`Grooming decision: ${decision}`);

  // Track sub-issues created
  let subIssuesCreated = 0;

  // Apply the decision
  if (decision === "ready") {
    // Add 'groomed' label to indicate issue is ready for implementation
    try {
      await ctx.octokit.rest.issues.addLabels({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: action.issueNumber,
        labels: ["groomed"],
      });
      core.info(`Added 'groomed' label to issue #${action.issueNumber}`);
    } catch (error) {
      core.warning(`Failed to add 'groomed' label: ${error}`);
    }

    // Check if engineer recommends splitting into phases
    const engineerOutput = groomingOutput.engineer as EngineerOutput;
    if (
      engineerOutput.scope_recommendation === "split" &&
      engineerOutput.recommended_phases &&
      engineerOutput.recommended_phases.length > 0
    ) {
      core.info(
        `Engineer recommends splitting into ${engineerOutput.recommended_phases.length} phases`,
      );
      subIssuesCreated = await createSubIssuesForPhases(
        ctx,
        action.issueNumber,
        engineerOutput.recommended_phases,
      );
    }
  } else {
    // Collect questions from agents
    const questions: string[] = [];
    for (const [agentType, output] of Object.entries(groomingOutput)) {
      const agentOutput = output as GroomingAgentOutput;
      if (agentOutput.questions && agentOutput.questions.length > 0) {
        questions.push(`**${agentType}:**`);
        questions.push(...agentOutput.questions.map((q) => `- ${q}`));
      }
    }

    // Post comment with questions
    if (questions.length > 0) {
      await ctx.octokit.rest.issues.createComment({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: action.issueNumber,
        body: `## Grooming Questions\n\nThe following questions need to be addressed before this issue is ready:\n\n${questions.join("\n")}`,
      });
    }
  }

  return { applied: true, decision, subIssuesCreated };
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
      const result = await addSubIssueToParent(
        ctx.owner,
        ctx.repo,
        parentIssueNumber,
        { title, body },
        {
          octokit: ctx.octokit,
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
      const { data: parentIssue } = await ctx.octokit.rest.issues.get({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: parentIssueNumber,
      });

      const existingBody = parentIssue.body || "";
      const agentNote = `\n\n## Agent Notes\n\nGrooming complete. Sub-issues created for phased implementation.`;
      const newBody = existingBody + agentNote;

      await ctx.octokit.rest.issues.update({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: parentIssueNumber,
        body: newBody,
      });
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
  const children: Root["children"] = [];

  // Description section
  children.push(...createSection("Description", [createParagraph(phase.description)]));

  // Affected Areas section
  if (phase.affected_areas && phase.affected_areas.length > 0) {
    const areas = phase.affected_areas.map((area) => {
      const changeType = area.change_type ? ` (${area.change_type})` : "";
      const desc = area.description ? ` - ${area.description}` : "";
      return `\`${area.path}\`${changeType}${desc}`;
    });
    children.push(...createSection("Affected Areas", [createBulletList(areas)]));
  }

  // Todo section
  if (phase.todos && phase.todos.length > 0) {
    const todos: TodoItem[] = phase.todos.map((todo) => ({
      text: todo.task,
      checked: false,
      manual: todo.manual || false,
    }));
    children.push(...createSection("Todo", [createTodoList(todos)]));
  }

  return { type: "root", children };
}
