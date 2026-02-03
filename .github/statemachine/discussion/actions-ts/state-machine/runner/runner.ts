import * as core from "@actions/core";
import * as github from "@actions/github";
import type { DiscussionAction } from "../schemas/index.js";
import {
  executeAddDiscussionComment,
  executeUpdateDiscussionBody,
  executeAddDiscussionReaction,
  executeCreateIssuesFromDiscussion,
} from "./executors/discussions.js";
import {
  executeApplyDiscussionResearchOutput,
  executeApplyDiscussionRespondOutput,
  executeApplyDiscussionSummarizeOutput,
  executeApplyDiscussionPlanOutput,
} from "./executors/discussion-apply.js";

/**
 * Runner context - shared state for action execution
 */
export interface RunnerContext {
  octokit: ReturnType<typeof github.getOctokit>;
  owner: string;
  repo: string;
  dryRun: boolean;
  structuredOutput?: unknown;
}

/**
 * Action execution result
 */
interface ActionResult {
  action: DiscussionAction;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Execute a single discussion action
 */
export async function executeAction(
  action: DiscussionAction,
  ctx: RunnerContext,
): Promise<ActionResult> {
  try {
    core.info(`Executing action: ${action.type}`);

    let result: Record<string, unknown> = {};

    switch (action.type) {
      case "addDiscussionComment":
        result = await executeAddDiscussionComment(action, ctx);
        break;

      case "updateDiscussionBody":
        result = await executeUpdateDiscussionBody(action, ctx);
        break;

      case "addDiscussionReaction":
        result = await executeAddDiscussionReaction(action, ctx);
        break;

      case "createIssuesFromDiscussion":
        result = await executeCreateIssuesFromDiscussion(action, ctx);
        break;

      case "applyDiscussionResearchOutput":
        result = await executeApplyDiscussionResearchOutput(
          action,
          ctx,
          ctx.structuredOutput,
        );
        break;

      case "applyDiscussionRespondOutput":
        result = await executeApplyDiscussionRespondOutput(
          action,
          ctx,
          ctx.structuredOutput,
        );
        break;

      case "applyDiscussionSummarizeOutput":
        result = await executeApplyDiscussionSummarizeOutput(
          action,
          ctx,
          ctx.structuredOutput,
        );
        break;

      case "applyDiscussionPlanOutput":
        result = await executeApplyDiscussionPlanOutput(
          action,
          ctx,
          ctx.structuredOutput,
        );
        break;

      case "runClaude":
        // runClaude is handled externally by the workflow
        core.info(`runClaude action will be handled by workflow`);
        result = { scheduled: true };
        break;

      case "log":
        // Log action - just log the message
        switch (action.level) {
          case "debug":
            core.debug(action.message);
            break;
          case "info":
            core.info(action.message);
            break;
          case "warning":
            core.warning(action.message);
            break;
          case "error":
            core.error(action.message);
            break;
        }
        result = { logged: true };
        break;

      default:
        throw new Error(`Unknown action type: ${(action as { type: string }).type}`);
    }

    return { action, success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Action ${action.type} failed: ${errorMessage}`);
    return { action, success: false, error: errorMessage };
  }
}

/**
 * Execute a list of actions in sequence
 */
export async function executeActions(
  actions: DiscussionAction[],
  ctx: RunnerContext,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of actions) {
    const result = await executeAction(action, ctx);
    results.push(result);

    // Stop on critical failures
    if (!result.success && shouldStopOnError(action)) {
      core.warning(`Stopping execution due to failed action: ${action.type}`);
      break;
    }
  }

  return results;
}

/**
 * Determine if we should stop execution on error for this action type
 */
function shouldStopOnError(action: DiscussionAction): boolean {
  // Continue on log failures, stop on everything else
  return action.type !== "log";
}
