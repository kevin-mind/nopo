/**
 * Discussion Apply Executors
 *
 * Executors for applying Claude's structured output from discussion workflows.
 * TODO: Full implementation to be migrated from .github/statemachine
 */

import * as core from "@actions/core";
import * as fs from "node:fs";
import type {
  ApplyDiscussionResearchOutputAction,
  ApplyDiscussionRespondOutputAction,
  ApplyDiscussionSummarizeOutputAction,
  ApplyDiscussionPlanOutputAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import {
  executeAddDiscussionComment,
  executeUpdateDiscussionBody,
  executeCreateIssuesFromDiscussion,
} from "./discussions.js";

// ============================================================================
// Types
// ============================================================================

interface ResearchOutput {
  research_threads: Array<{
    title: string;
    question: string;
    investigation_areas: string[];
    expected_deliverables: string[];
  }>;
  updated_description?: string;
}

interface RespondOutput {
  response: string;
  should_continue: boolean;
}

interface SummarizeOutput {
  summary: string;
}

interface PlanOutput {
  issues: Array<{
    title: string;
    body: string;
    labels: string[];
  }>;
  summary_comment: string;
}

// ============================================================================
// Apply Research Output
// ============================================================================

/**
 * Apply discussion research output from Claude's structured output
 */
export async function executeApplyDiscussionResearchOutput(
  action: ApplyDiscussionResearchOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; threadCount: number }> {
  let output: ResearchOutput;

  if (structuredOutput) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- structured output from Claude SDK is typed as unknown
    output = structuredOutput as ResearchOutput;
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, file content matches ResearchOutput schema
    output = JSON.parse(content) as ResearchOutput;
    core.info(`Research output from file: ${action.filePath}`);
  } else {
    throw new Error("No structured output provided and file not found");
  }

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would create ${output.research_threads.length} research threads`,
    );
    return { applied: true, threadCount: output.research_threads.length };
  }

  // Create research thread comments
  for (const thread of output.research_threads) {
    const body = `## 🔍 ${thread.title}\n\n**Question:** ${thread.question}\n\n**Areas to investigate:**\n${thread.investigation_areas.map((a) => `- ${a}`).join("\n")}`;

    await executeAddDiscussionComment(
      {
        type: "addDiscussionComment",
        token: "code",
        discussionNodeId: action.discussionNodeId,
        body,
      },
      ctx,
    );
  }

  // Update description if provided
  if (output.updated_description) {
    await executeUpdateDiscussionBody(
      {
        type: "updateDiscussionBody",
        token: "code",
        discussionNodeId: action.discussionNodeId,
        newBody: output.updated_description,
      },
      ctx,
    );
  }

  core.info(
    `Created ${output.research_threads.length} research threads for discussion #${action.discussionNumber}`,
  );
  return { applied: true, threadCount: output.research_threads.length };
}

// ============================================================================
// Apply Respond Output
// ============================================================================

/**
 * Apply discussion respond output from Claude's structured output
 */
export async function executeApplyDiscussionRespondOutput(
  action: ApplyDiscussionRespondOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; shouldContinue: boolean }> {
  let output: RespondOutput;

  if (structuredOutput) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- structured output from Claude SDK is typed as unknown
    output = structuredOutput as RespondOutput;
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, file content matches RespondOutput schema
    output = JSON.parse(content) as RespondOutput;
    core.info(`Respond output from file: ${action.filePath}`);
  } else {
    throw new Error("No structured output provided and file not found");
  }

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would post response to discussion`);
    return { applied: true, shouldContinue: output.should_continue };
  }

  // Post the response
  await executeAddDiscussionComment(
    {
      type: "addDiscussionComment",
      token: "code",
      discussionNodeId: action.discussionNodeId,
      body: output.response,
      replyToNodeId: action.replyToNodeId,
    },
    ctx,
  );

  core.info(`Posted response to discussion #${action.discussionNumber}`);
  return { applied: true, shouldContinue: output.should_continue };
}

// ============================================================================
// Apply Summarize Output
// ============================================================================

/**
 * Apply discussion summarize output from Claude's structured output
 */
export async function executeApplyDiscussionSummarizeOutput(
  action: ApplyDiscussionSummarizeOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean }> {
  let output: SummarizeOutput;

  if (structuredOutput) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- structured output from Claude SDK is typed as unknown
    output = structuredOutput as SummarizeOutput;
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, file content matches SummarizeOutput schema
    output = JSON.parse(content) as SummarizeOutput;
    core.info(`Summarize output from file: ${action.filePath}`);
  } else {
    throw new Error("No structured output provided and file not found");
  }

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would update discussion body with summary`);
    return { applied: true };
  }

  // Update the discussion body with the summary
  await executeUpdateDiscussionBody(
    {
      type: "updateDiscussionBody",
      token: "code",
      discussionNodeId: action.discussionNodeId,
      newBody: output.summary,
    },
    ctx,
  );

  core.info(`Updated discussion #${action.discussionNumber} with summary`);
  return { applied: true };
}

// ============================================================================
// Apply Plan Output
// ============================================================================

/**
 * Apply discussion plan output from Claude's structured output
 */
export async function executeApplyDiscussionPlanOutput(
  action: ApplyDiscussionPlanOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; issueNumbers: number[] }> {
  let output: PlanOutput;

  if (structuredOutput) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- structured output from Claude SDK is typed as unknown
    output = structuredOutput as PlanOutput;
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    const content = fs.readFileSync(action.filePath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, file content matches PlanOutput schema
    output = JSON.parse(content) as PlanOutput;
    core.info(`Plan output from file: ${action.filePath}`);
  } else {
    throw new Error("No structured output provided and file not found");
  }

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would create ${output.issues.length} issues from plan`,
    );
    return { applied: true, issueNumbers: [] };
  }

  // Create issues
  const result = await executeCreateIssuesFromDiscussion(
    {
      type: "createIssuesFromDiscussion",
      token: "code",
      discussionNumber: action.discussionNumber,
      issues: output.issues,
    },
    ctx,
  );

  // Post summary comment
  await executeAddDiscussionComment(
    {
      type: "addDiscussionComment",
      token: "code",
      discussionNodeId: action.discussionNodeId,
      body: output.summary_comment,
    },
    ctx,
  );

  core.info(
    `Created ${result.issueNumbers.length} issues from discussion #${action.discussionNumber}`,
  );
  return { applied: true, issueNumbers: result.issueNumbers };
}
