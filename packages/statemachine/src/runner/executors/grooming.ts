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
  parseIssue,
  createComment,
  type OctokitLike,
  type ProjectStatus,
} from "@more/issue-state";
import type {
  RunClaudeGroomingAction,
  ApplyGroomingOutputAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { appendAgentNotes } from "../../parser/index.js";
import {
  CombinedGroomingOutputSchema,
  EngineerOutputSchema,
  parseOutput,
  type CombinedGroomingOutput,
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
      outputs: parseOutput(
        CombinedGroomingOutputSchema,
        ctx.mockOutputs.grooming,
        "mock grooming",
      ),
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

    // Check if engineer recommends splitting into phases
    const engineerOutput = parseOutput(
      EngineerOutputSchema,
      groomingOutput.engineer,
      "engineer",
    );
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
      const agentOutput = output;
      if (agentOutput.questions && agentOutput.questions.length > 0) {
        questions.push(`**${agentType}:**`);
        questions.push(...agentOutput.questions.map((q) => `- ${q}`));
      }
    }

    // Post comment with questions
    if (questions.length > 0) {
      await createComment(
        ctx.owner,
        ctx.repo,
        action.issueNumber,
        `## Grooming Questions\n\nThe following questions need to be addressed before this issue is ready:\n\n${questions.join("\n")}`,
        asOctokitLike(ctx),
      );
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
