/**
 * Grooming Executors
 *
 * Executors for running parallel grooming agents and applying their outputs.
 * TODO: Full implementation to be migrated from .github/statemachine
 */

import * as core from "@actions/core";
import * as fs from "fs";
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
 *
 * TODO: Full implementation with sub-issue creation
 */
export async function executeApplyGroomingOutput(
  action: ApplyGroomingOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; decision: string }> {
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

  return { applied: true, decision };
}
