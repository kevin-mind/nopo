/**
 * Action Executor
 *
 * Types and functions for executing action arrays produced by the state machine.
 * Formerly split across core/runner/runner.ts and core/runner/types.ts.
 */

import * as core from "@actions/core";
import type { GitHub } from "@actions/github/lib/utils.js";
import type { Action, TokenType } from "./schemas/actions/index.js";
import {
  actions as actionDefs,
  ActionSchema,
  isTerminalAction,
  shouldStopOnError,
} from "./schemas/actions/index.js";
import { signalStart, signalEnd } from "./signaler.js";

// ============================================================================
// Types
// ============================================================================

export type Octokit = InstanceType<typeof GitHub>;

/**
 * Mock outputs for Claude prompts (used in test mode to skip real Claude calls)
 */
export interface MockOutputs {
  triage?: Record<string, unknown>;
  iterate?: Record<string, unknown>;
  review?: Record<string, unknown>;
  comment?: Record<string, unknown>;
  "review-response"?: Record<string, unknown>;
  [key: string]: Record<string, unknown> | undefined;
}

/**
 * Issue context for providing issue data to executors
 * Used when running outside the workflow (e.g., test runner) where
 * GitHub API fetches aren't appropriate
 */
interface IssueContext {
  number: number;
  title: string;
  body: string;
  comments?: string;
}

/**
 * Context for action execution
 *
 * Supports two octokits for different token types:
 * - octokit (code token): For code operations (push, PR, project fields)
 * - reviewOctokit (review token): For review operations (submit reviews)
 */
export interface RunnerContext {
  /** Primary octokit for code operations (push, PR, project fields) */
  octokit: Octokit;
  /** Optional octokit for review operations (submit reviews) */
  reviewOctokit?: Octokit;
  owner: string;
  repo: string;
  projectNumber: number;
  serverUrl: string;
  dryRun?: boolean;
  /** URL to the workflow run (optional, used for history entries) */
  runUrl?: string;
  /** Mock outputs for Claude calls (skip real Claude in test mode) */
  mockOutputs?: MockOutputs;
  /** Issue context for executors that need issue data without API fetch */
  issueContext?: IssueContext;
}

// Signaler Types

export type ResourceType = "issue" | "pr" | "discussion";
export type RunnerJobResult = "success" | "failure" | "cancelled";

export interface ProgressInfo {
  iteration?: number;
  consecutiveFailures?: number;
  maxRetries?: number;
}

/**
 * Extended context for signaled execution
 * Includes all information needed for status comments
 */
export interface SignaledRunnerContext extends RunnerContext {
  /** Resource type for status comments */
  resourceType: ResourceType;
  /** Issue or PR number */
  resourceNumber: number;
  /** Job name for status messages */
  job: string;
  /** URL to the workflow run */
  runUrl: string;
  /** Comment ID that triggered this run (for reactions) */
  triggerCommentId?: string;
  /** Progress info for iteration display */
  progress?: ProgressInfo;
}

// Action Results

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
 * Context passed between sequential actions
 * Used to pass structured output from runClaude to applyTriageOutput
 */
export interface ActionChainContext {
  /** Structured output from the last runClaude action */
  lastClaudeStructuredOutput?: unknown;
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
 * Options for the executor
 */
export interface RunnerOptions {
  stopOnError?: boolean;
  logActions?: boolean;
}

/**
 * Result of signaled execution
 * Includes the status comment ID for reference
 */
export interface SignaledRunnerResult extends RunnerResult {
  /** ID of the status comment created (string for discussions, numeric string for issues/PRs) */
  statusCommentId: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the appropriate octokit based on the action's token field
 */
export function getOctokitForAction(
  action: Action,
  ctx: RunnerContext,
): Octokit {
  const tokenType: TokenType = action.token || "code";
  if (tokenType === "review" && ctx.reviewOctokit) {
    return ctx.reviewOctokit;
  }
  return ctx.octokit;
}

// ============================================================================
// Action Execution
// ============================================================================

/**
 * Execute a single action via the unified actions object
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

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Action.type is a string union; narrowing to keyof is safe at runtime
  const def = actionDefs[action.type as keyof typeof actionDefs];
  return def.execute(action, actionCtx, chainCtx);
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
        // Only stop when a PR already exists. If createPR is in the action
        // list, no PR exists yet — continuing lets Claude work and create it.
        // Without a PR, the push event would be skipped by sm-plan anyway.
        const hasPendingCreatePR = actions.some((a) => a.type === "createPR");

        if (!hasPendingCreatePR) {
          results.push({
            action: validatedAction,
            success: true,
            skipped: false,
            result,
            durationMs: Date.now() - actionStartTime,
          });

          // PR exists — stop and let CI re-trigger with rebased branch
          stoppedEarly = true;
          stopReason = "branch_rebased_and_pushed";
          core.info(
            "Stopping after branch rebase - CI will re-trigger with up-to-date branch",
          );
          break;
        }

        // No PR yet — continue execution so Claude can work and create one.
        // The rebase push event will be harmlessly skipped by sm-plan.
        core.info(
          "Branch rebased and pushed, but no PR exists yet — continuing execution",
        );
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
            ? validatedAction.message
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
 * Log a summary of the execution results
 */
export function logRunnerSummary(result: RunnerResult): void {
  core.info("=".repeat(60));
  core.info("Execution Summary");
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
