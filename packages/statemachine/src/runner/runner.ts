/**
 * Action Runner
 *
 * Executes action arrays produced by the state machine.
 */

import * as core from "@actions/core";
import * as fs from "fs";
import type { Action, ActionType } from "../schemas/actions.js";
import {
  ActionSchema,
  isTerminalAction,
  shouldStopOnError,
} from "../schemas/actions.js";
import type {
  RunnerContext,
  RunnerResult,
  RunnerOptions,
  ActionResult,
  ActionChainContext,
  SignaledRunnerContext,
  SignaledRunnerResult,
  Octokit,
  ProgressInfo,
  RunnerJobResult,
} from "./types.js";
import { getOctokitForAction } from "./types.js";
import { signalStart, signalEnd } from "./signaler.js";
import * as executors from "./executors/index.js";

// Re-export types
export type {
  RunnerContext,
  RunnerResult,
  RunnerOptions,
  ActionResult,
  ActionChainContext,
  SignaledRunnerContext,
  SignaledRunnerResult,
  Octokit,
  ProgressInfo,
  RunnerJobResult,
};
export type { ResourceType, MockOutputs } from "./types.js";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get structured output from chain context or file
 *
 * For matrix job execution where actions run in separate jobs,
 * the structured output is passed through artifacts. This function
 * reads from the file if chain context doesn't have the output.
 */
function getStructuredOutput(
  action: Action,
  chainCtx?: ActionChainContext,
): unknown | undefined {
  // First try chain context (same-job execution)
  if (chainCtx?.lastClaudeStructuredOutput) {
    core.info("Using structured output from chain context");
    return chainCtx.lastClaudeStructuredOutput;
  }

  // Check if action has a filePath for artifact-based execution
  const actionWithFile = action as Action & { filePath?: string };
  if (actionWithFile.filePath) {
    core.info(
      `Checking for structured output file: ${actionWithFile.filePath}`,
    );
    core.info(`Current working directory: ${process.cwd()}`);

    // List files in current directory for debugging
    try {
      const files = fs.readdirSync(".");
      core.info(`Files in cwd: ${files.slice(0, 20).join(", ")}`);
    } catch (e) {
      core.warning(`Failed to list files: ${e}`);
    }

    if (fs.existsSync(actionWithFile.filePath)) {
      try {
        const content = fs.readFileSync(actionWithFile.filePath, "utf-8");
        const parsed = JSON.parse(content);
        core.info(
          `Loaded structured output from file: ${actionWithFile.filePath}`,
        );
        return parsed;
      } catch (e) {
        core.warning(
          `Failed to read structured output from ${actionWithFile.filePath}: ${e}`,
        );
      }
    } else {
      core.warning(`File not found: ${actionWithFile.filePath}`);
    }
  }

  return undefined;
}

// ============================================================================
// Action Execution
// ============================================================================

/**
 * Execute a single action
 */
async function executeAction(
  action: Action,
  ctx: RunnerContext,
  chainCtx?: ActionChainContext,
): Promise<unknown> {
  // Create a context with the appropriate octokit for this action
  const actionCtx: RunnerContext = {
    ...ctx,
    octokit: getOctokitForAction(action, ctx),
  };

  switch (action.type) {
    // Project field actions
    case "updateProjectStatus":
      return executors.executeUpdateProjectStatus(action, actionCtx);
    case "incrementIteration":
      return executors.executeIncrementIteration(action, actionCtx);
    case "recordFailure":
      return executors.executeRecordFailure(action, actionCtx);
    case "clearFailures":
      return executors.executeClearFailures(action, actionCtx);
    case "block":
      return executors.executeBlock(action, actionCtx);

    // Issue actions
    case "closeIssue":
      return executors.executeCloseIssue(action, actionCtx);
    case "reopenIssue":
      core.info(`Reopen issue #${action.issueNumber} - handled by resetIssue`);
      return { reopened: true };
    case "resetIssue":
      return executors.executeResetIssue(action, actionCtx);
    case "appendHistory":
      return executors.executeAppendHistory(action, actionCtx);
    case "updateHistory":
      return executors.executeUpdateHistory(action, actionCtx);
    case "updateIssueBody":
      return executors.executeUpdateIssueBody(action, actionCtx);
    case "addComment":
      return executors.executeAddComment(action, actionCtx);
    case "unassignUser":
      return executors.executeUnassignUser(action, actionCtx);
    case "assignUser":
      return executors.executeAssignUser(action, actionCtx);
    case "createSubIssues":
      return executors.executeCreateSubIssues(action, actionCtx);
    case "addLabel":
      return executors.executeAddLabel(action, actionCtx);
    case "removeLabel":
      return executors.executeRemoveLabel(action, actionCtx);

    // Git actions
    case "createBranch":
      return executors.executeCreateBranch(action, actionCtx);
    case "gitPush":
      return executors.executeGitPush(action, actionCtx);

    // PR actions
    case "createPR":
      return executors.executeCreatePR(action, actionCtx);
    case "convertPRToDraft":
      return executors.executeConvertPRToDraft(action, actionCtx);
    case "markPRReady":
      return executors.executeMarkPRReady(action, actionCtx);
    case "requestReview":
      return executors.executeRequestReview(action, actionCtx);
    case "mergePR":
      return executors.executeMergePR(action, actionCtx);
    case "submitReview":
      return executors.executeSubmitReview(action, actionCtx);
    case "removeReviewer":
      return executors.executeRemoveReviewer(action, actionCtx);

    // Claude actions
    case "runClaude":
      return executors.executeRunClaude(action, actionCtx);

    // Discussion actions
    case "addDiscussionComment":
      return executors.executeAddDiscussionComment(action, actionCtx);
    case "updateDiscussionBody":
      return executors.executeUpdateDiscussionBody(action, actionCtx);
    case "addDiscussionReaction":
      return executors.executeAddDiscussionReaction(action, actionCtx);
    case "createIssuesFromDiscussion":
      return executors.executeCreateIssuesFromDiscussion(action, actionCtx);

    // Triage actions
    case "applyTriageOutput":
      return executors.executeApplyTriageOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Iterate actions
    case "applyIterateOutput":
      return executors.executeApplyIterateOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Grooming actions
    case "runClaudeGrooming":
      return executors.executeRunClaudeGrooming(action, actionCtx);
    case "applyGroomingOutput":
      return executors.executeApplyGroomingOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Pivot actions
    case "applyPivotOutput":
      return executors.executeApplyPivotOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Agent notes actions
    case "appendAgentNotes":
      return executors.executeAppendAgentNotes(action, actionCtx);

    // Review actions
    case "applyReviewOutput":
      return executors.executeApplyReviewOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // PR response actions
    case "applyPRResponseOutput":
      return executors.executeApplyPRResponseOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Discussion apply actions
    case "applyDiscussionResearchOutput":
      return executors.executeApplyDiscussionResearchOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );
    case "applyDiscussionRespondOutput":
      return executors.executeApplyDiscussionRespondOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );
    case "applyDiscussionSummarizeOutput":
      return executors.executeApplyDiscussionSummarizeOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );
    case "applyDiscussionPlanOutput":
      return executors.executeApplyDiscussionPlanOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );
    case "investigateResearchThreads":
      return executors.executeInvestigateResearchThreads(action, actionCtx);
    case "updateDiscussionSummary":
      return executors.executeUpdateDiscussionSummary(action, actionCtx);

    // Control flow actions
    case "stop":
      core.info(`Stopping: ${action.reason}`);
      return { stopped: true, reason: action.reason };

    case "log":
      switch (action.level) {
        case "debug":
          core.debug(action.message);
          break;
        case "warning":
          core.warning(action.message);
          break;
        case "error":
          core.error(action.message);
          break;
        default:
          core.info(action.message);
      }
      return { logged: true };

    case "noop":
      core.debug(`No-op: ${action.reason || "no reason given"}`);
      return { noop: true };

    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}

// ============================================================================
// Runner Implementation
// ============================================================================

/**
 * Execute an array of actions
 */
export async function executeActions(
  actions: Action[],
  ctx: RunnerContext,
  options: RunnerOptions = {},
): Promise<RunnerResult> {
  const startTime = Date.now();
  const results: ActionResult[] = [];
  let stoppedEarly = false;
  let stopReason: string | undefined;

  // Chain context for passing data between sequential actions
  const chainCtx: ActionChainContext = {};

  const { stopOnError = true, logActions = true } = options;

  for (const action of actions) {
    const actionStartTime = Date.now();

    // Validate action at runtime
    const parseResult = ActionSchema.safeParse(action);
    if (!parseResult.success) {
      core.error(`Invalid action: ${JSON.stringify(action)}`);
      results.push({
        action,
        success: false,
        skipped: false,
        error: new Error(`Invalid action: ${parseResult.error.message}`),
        durationMs: Date.now() - actionStartTime,
      });
      if (stopOnError) {
        stoppedEarly = true;
        stopReason = "Invalid action";
        break;
      }
      continue;
    }

    const validatedAction = parseResult.data;

    // Log action if enabled
    if (logActions) {
      core.info(`Executing action: ${validatedAction.type}`);
    }

    // Handle dry run
    if (ctx.dryRun) {
      core.info(`[DRY RUN] Would execute: ${validatedAction.type}`);
      results.push({
        action: validatedAction,
        success: true,
        skipped: true,
        durationMs: Date.now() - actionStartTime,
      });
      continue;
    }

    try {
      const result = await executeAction(validatedAction, ctx, chainCtx);

      // Capture structured output from runClaude for subsequent actions
      if (validatedAction.type === "runClaude") {
        const claudeResult = result as { structuredOutput?: unknown };
        if (claudeResult.structuredOutput) {
          chainCtx.lastClaudeStructuredOutput = claudeResult.structuredOutput;
          core.info("Stored structured output for subsequent actions");
        }
      }

      // Check if createBranch signaled to stop (rebased and pushed)
      const branchResult = result as { shouldStop?: boolean };
      if (validatedAction.type === "createBranch" && branchResult.shouldStop) {
        results.push({
          action: validatedAction,
          success: true,
          skipped: false,
          result,
          durationMs: Date.now() - actionStartTime,
        });

        // Stop processing - CI will re-trigger with rebased branch
        stoppedEarly = true;
        stopReason = "branch_rebased_and_pushed";
        core.info(
          "Stopping after branch rebase - CI will re-trigger with up-to-date branch",
        );
        break;
      }

      results.push({
        action: validatedAction,
        success: true,
        skipped: false,
        result,
        durationMs: Date.now() - actionStartTime,
      });

      // Check for terminal actions
      if (isTerminalAction(validatedAction)) {
        stoppedEarly = true;
        stopReason =
          validatedAction.type === "stop"
            ? validatedAction.reason
            : `${validatedAction.type} action`;
        break;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      core.error(`Action failed: ${validatedAction.type} - ${err.message}`);

      results.push({
        action: validatedAction,
        success: false,
        skipped: false,
        error: err,
        durationMs: Date.now() - actionStartTime,
      });

      // Check if we should stop on this error
      if (stopOnError && shouldStopOnError(validatedAction.type)) {
        stoppedEarly = true;
        stopReason = `Error in ${validatedAction.type}: ${err.message}`;
        break;
      }
    }
  }

  return {
    success: results.every((r) => r.success || r.skipped),
    results,
    totalDurationMs: Date.now() - startTime,
    stoppedEarly,
    stopReason,
  };
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * Create a runner context from GitHub action inputs
 */
export function createRunnerContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  projectNumber: number,
  options: {
    dryRun?: boolean;
    serverUrl?: string;
    reviewOctokit?: Octokit;
    mockOutputs?: RunnerContext["mockOutputs"];
  } = {},
): RunnerContext {
  return {
    octokit,
    reviewOctokit: options.reviewOctokit,
    owner,
    repo,
    projectNumber,
    serverUrl:
      options.serverUrl ||
      process.env.GITHUB_SERVER_URL ||
      "https://github.com",
    dryRun: options.dryRun,
    mockOutputs: options.mockOutputs,
  };
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log a summary of the runner results
 */
export function logRunnerSummary(result: RunnerResult): void {
  core.info("=".repeat(60));
  core.info("Runner Summary");
  core.info("=".repeat(60));
  core.info(`Total actions: ${result.results.length}`);
  core.info(`Successful: ${result.results.filter((r) => r.success).length}`);
  core.info(
    `Failed: ${result.results.filter((r) => !r.success && !r.skipped).length}`,
  );
  core.info(`Skipped: ${result.results.filter((r) => r.skipped).length}`);
  core.info(`Total duration: ${result.totalDurationMs}ms`);
  if (result.stoppedEarly) {
    core.info(`Stopped early: ${result.stopReason}`);
  }
  core.info("=".repeat(60));

  // Log individual action results
  for (const actionResult of result.results) {
    const status = actionResult.skipped
      ? "SKIPPED"
      : actionResult.success
        ? "SUCCESS"
        : "FAILED";
    const duration = `${actionResult.durationMs}ms`;
    core.info(
      `  ${status.padEnd(8)} ${actionResult.action.type.padEnd(25)} ${duration}`,
    );
    if (actionResult.error) {
      core.error(`    Error: ${actionResult.error.message}`);
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Filter actions by type
 */
export function filterActions<T extends ActionType>(
  actions: Action[],
  type: T,
): Extract<Action, { type: T }>[] {
  return actions.filter((a) => a.type === type) as Extract<
    Action,
    { type: T }
  >[];
}

/**
 * Count actions by type
 */
export function countActionsByType(
  actions: Action[],
): Record<ActionType, number> {
  const counts: Partial<Record<ActionType, number>> = {};
  for (const action of actions) {
    counts[action.type] = (counts[action.type] || 0) + 1;
  }
  return counts as Record<ActionType, number>;
}

// ============================================================================
// Signaled Execution
// ============================================================================

/**
 * Execute actions with automatic status signaling
 *
 * 1. Posts a "loading" status comment before execution
 * 2. Executes all actions
 * 3. Updates the status comment with success/failure/cancelled
 */
export async function runWithSignaling(
  actions: Action[],
  ctx: SignaledRunnerContext,
  options: RunnerOptions = {},
): Promise<SignaledRunnerResult> {
  let statusCommentId = "";

  // Skip signaling for dry run
  if (ctx.dryRun) {
    core.info("[DRY RUN] Skipping status signaling");
    const result = await executeActions(actions, ctx, options);
    return { ...result, statusCommentId: "" };
  }

  try {
    // 1. Signal start - post "loading" status comment
    statusCommentId = await signalStart(
      {
        octokit: ctx.octokit,
        owner: ctx.owner,
        repo: ctx.repo,
        resourceType: ctx.resourceType,
        resourceNumber: ctx.resourceNumber,
        job: ctx.job,
        runUrl: ctx.runUrl,
        triggerCommentId: ctx.triggerCommentId,
      },
      ctx.progress,
    );
  } catch (error) {
    // Don't fail the run if we can't create a status comment
    core.warning(`Failed to create status comment: ${error}`);
  }

  // 2. Execute all actions
  const result = await executeActions(actions, ctx, options);

  // 3. Signal end - update status comment with result
  if (statusCommentId !== "") {
    try {
      const jobResult: RunnerJobResult = result.success ? "success" : "failure";
      await signalEnd(
        {
          octokit: ctx.octokit,
          owner: ctx.owner,
          repo: ctx.repo,
          resourceType: ctx.resourceType,
          resourceNumber: ctx.resourceNumber,
          job: ctx.job,
          runUrl: ctx.runUrl,
          triggerCommentId: ctx.triggerCommentId,
        },
        statusCommentId,
        jobResult,
      );
    } catch (error) {
      core.warning(`Failed to update status comment: ${error}`);
    }
  }

  return { ...result, statusCommentId };
}

/**
 * Create a signaled runner context
 */
export function createSignaledRunnerContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  projectNumber: number,
  resourceType: SignaledRunnerContext["resourceType"],
  resourceNumber: number,
  job: string,
  runUrl: string,
  options: {
    dryRun?: boolean;
    serverUrl?: string;
    reviewOctokit?: Octokit;
    triggerCommentId?: string;
    progress?: ProgressInfo;
    mockOutputs?: RunnerContext["mockOutputs"];
  } = {},
): SignaledRunnerContext {
  return {
    octokit,
    reviewOctokit: options.reviewOctokit,
    owner,
    repo,
    projectNumber,
    serverUrl:
      options.serverUrl ||
      process.env.GITHUB_SERVER_URL ||
      "https://github.com",
    dryRun: options.dryRun,
    mockOutputs: options.mockOutputs,
    resourceType,
    resourceNumber,
    job,
    runUrl,
    triggerCommentId: options.triggerCommentId,
    progress: options.progress,
  };
}
