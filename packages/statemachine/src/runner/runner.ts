/**
 * Action Runner
 *
 * Executes action arrays produced by the state machine.
 */

import * as core from "@actions/core";
import type { Action } from "../schemas/actions.js";
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
import { ACTION_REGISTRY } from "./action-registry.js";
import { dispatchAction } from "./create-action.js";

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
// Action Execution
// ============================================================================

/**
 * Execute a single action via registry lookup
 */
async function executeAction(
  action: Action,
  ctx: RunnerContext,
  chainCtx?: ActionChainContext,
): Promise<unknown> {
  const actionCtx: RunnerContext = {
    ...ctx,
    octokit: getOctokitForAction(action, ctx),
  };

  return dispatchAction(ACTION_REGISTRY, action, actionCtx, chainCtx);
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
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- executeAction return type is a union, narrowing by action.type
        const claudeResult = result as { structuredOutput?: unknown };
        if (claudeResult.structuredOutput) {
          chainCtx.lastClaudeStructuredOutput = claudeResult.structuredOutput;
          core.info("Stored structured output for subsequent actions");
        }
      }

      // Capture grooming output for subsequent applyGroomingOutput action
      if (validatedAction.type === "runClaudeGrooming") {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- executeAction return type is a union, narrowing by action.type
        const groomingResult = result as { outputs?: unknown };
        if (groomingResult.outputs) {
          chainCtx.lastClaudeStructuredOutput = groomingResult.outputs;
          core.info("Stored grooming outputs for subsequent actions");
        }
      }

      // Capture applyGroomingOutput result for subsequent reconcileSubIssues action
      if (validatedAction.type === "applyGroomingOutput") {
        chainCtx.lastClaudeStructuredOutput = result;
        core.info("Stored grooming decision for subsequent reconcileSubIssues");
      }

      // Check if createBranch signaled to stop (rebased and pushed)
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- executeAction return type is a union, narrowing by action.type
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
    issueContext?: RunnerContext["issueContext"];
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
    issueContext: options.issueContext,
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
export function filterActions<T extends Action["type"]>(
  actions: Action[],
  type: T,
): Extract<Action, { type: T }>[] {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- filter narrows by type but TS cannot infer the discriminated union member
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
): Record<Action["type"], number> {
  const counts: Partial<Record<Action["type"], number>> = {};
  for (const action of actions) {
    counts[action.type] = (counts[action.type] || 0) + 1;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Partial<Record> built from exhaustive loop, safe to cast to Record
  return counts as Record<Action["type"], number>;
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
