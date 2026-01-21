import type { GitHub } from "@actions/github/lib/utils.js";
import * as core from "@actions/core";
import type { Action, ActionType } from "../schemas/index.js";
import {
  ActionSchema,
  isTerminalAction,
  shouldStopOnError,
} from "../schemas/index.js";

// Import executors
import {
  executeUpdateProjectStatus,
  executeIncrementIteration,
  executeRecordFailure,
  executeClearFailures,
  executeBlock,
} from "./executors/project.js";
import {
  executeCloseIssue,
  executeAppendHistory,
  executeUpdateHistory,
  executeUpdateIssueBody,
  executeAddComment,
  executeUnassignUser,
  executeCreateSubIssues,
  executeCreatePR,
  executeConvertPRToDraft,
  executeMarkPRReady,
  executeRequestReview,
  executeMergePR,
} from "./executors/github.js";
import { executeCreateBranch, executeGitPush } from "./executors/git.js";
import { executeRunClaude } from "./executors/claude.js";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// Types
// ============================================================================

/**
 * Context for action execution
 */
export interface RunnerContext {
  octokit: Octokit;
  owner: string;
  repo: string;
  projectNumber: number;
  serverUrl: string;
  dryRun?: boolean;
}

/**
 * Result of executing a single action
 */
export interface ActionResult {
  action: Action;
  success: boolean;
  skipped: boolean;
  result?: unknown;
  error?: Error;
  durationMs: number;
}

/**
 * Result of executing all actions
 */
export interface RunnerResult {
  success: boolean;
  results: ActionResult[];
  totalDurationMs: number;
  stoppedEarly: boolean;
  stopReason?: string;
}

/**
 * Options for the runner
 */
export interface RunnerOptions {
  stopOnError?: boolean;
  logActions?: boolean;
}

// ============================================================================
// Runner Implementation
// ============================================================================

/**
 * Execute a single action
 */
async function executeAction(
  action: Action,
  ctx: RunnerContext,
): Promise<unknown> {
  switch (action.type) {
    // Project field actions
    case "updateProjectStatus":
      return executeUpdateProjectStatus(action, ctx);
    case "incrementIteration":
      return executeIncrementIteration(action, ctx);
    case "recordFailure":
      return executeRecordFailure(action, ctx);
    case "clearFailures":
      return executeClearFailures(action, ctx);
    case "block":
      return executeBlock(action, ctx);

    // Issue actions
    case "closeIssue":
      return executeCloseIssue(action, ctx);
    case "appendHistory":
      return executeAppendHistory(action, ctx);
    case "updateHistory":
      return executeUpdateHistory(action, ctx);
    case "updateIssueBody":
      return executeUpdateIssueBody(action, ctx);
    case "addComment":
      return executeAddComment(action, ctx);
    case "unassignUser":
      return executeUnassignUser(action, ctx);
    case "createSubIssues":
      return executeCreateSubIssues(action, ctx);

    // Git actions
    case "createBranch":
      return executeCreateBranch(action, ctx);
    case "gitPush":
      return executeGitPush(action, ctx);

    // PR actions
    case "createPR":
      return executeCreatePR(action, ctx);
    case "convertPRToDraft":
      return executeConvertPRToDraft(action, ctx);
    case "markPRReady":
      return executeMarkPRReady(action, ctx);
    case "requestReview":
      return executeRequestReview(action, ctx);
    case "mergePR":
      return executeMergePR(action, ctx);

    // Claude actions
    case "runClaude":
      return executeRunClaude(action, ctx);

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
      const result = await executeAction(validatedAction, ctx);
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

/**
 * Create a runner context from GitHub action inputs
 */
export function createRunnerContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  projectNumber: number,
  options: { dryRun?: boolean; serverUrl?: string } = {},
): RunnerContext {
  return {
    octokit,
    owner,
    repo,
    projectNumber,
    serverUrl:
      options.serverUrl ||
      process.env.GITHUB_SERVER_URL ||
      "https://github.com",
    dryRun: options.dryRun,
  };
}

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
