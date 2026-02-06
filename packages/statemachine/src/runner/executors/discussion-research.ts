/**
 * Discussion Research Executors
 *
 * Executors for parallel investigation of research threads and updating discussion summaries.
 * TODO: Full implementation to be migrated from .github/statemachine
 */

import * as core from "@actions/core";
import type {
  InvestigateResearchThreadsAction,
  UpdateDiscussionSummaryAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { executeAddDiscussionComment } from "./discussions.js";

// ============================================================================
// Investigate Research Threads
// ============================================================================

/**
 * Investigate research threads in parallel
 * Runs Claude investigation agents for each thread concurrently
 * and posts findings as replies to each thread.
 *
 * TODO: Full implementation with parallel Claude calls
 */
export async function executeInvestigateResearchThreads(
  action: InvestigateResearchThreadsAction,
  ctx: RunnerContext,
): Promise<{ investigated: number }> {
  core.info(
    `Investigating ${action.threads.length} research threads for discussion #${action.discussionNumber}`,
  );

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would investigate ${action.threads.length} research threads`,
    );
    return { investigated: action.threads.length };
  }

  let investigated = 0;

  for (const thread of action.threads) {
    try {
      // TODO: Run Claude investigation for each thread
      // For now, post a placeholder response
      const responseBody = `## Investigation: ${thread.title}

**Question:** ${thread.question}

*Investigation in progress...*`;

      await executeAddDiscussionComment(
        {
          type: "addDiscussionComment",
          token: "code",
          discussionNodeId: action.discussionNodeId,
          body: responseBody,
          replyToNodeId: thread.commentNodeId,
        },
        ctx,
      );

      investigated++;
      core.info(`Investigated thread: ${thread.title}`);
    } catch (error) {
      core.warning(`Failed to investigate thread "${thread.title}": ${error}`);
    }
  }

  return { investigated };
}

// ============================================================================
// Update Discussion Summary
// ============================================================================

/**
 * Update discussion body with current state summary
 * Reads all threads and comments, generates a summary, and updates the body.
 *
 * TODO: Full implementation with Claude summary generation
 */
export async function executeUpdateDiscussionSummary(
  action: UpdateDiscussionSummaryAction,
  ctx: RunnerContext,
): Promise<{ updated: boolean }> {
  core.info(`Updating summary for discussion #${action.discussionNumber}`);

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would update discussion summary`);
    return { updated: true };
  }

  // TODO: Fetch all threads and comments, run Claude to generate summary
  // For now, just log that this would happen
  core.info(
    `Discussion summary update for #${action.discussionNumber} (implementation pending)`,
  );

  return { updated: true };
}
