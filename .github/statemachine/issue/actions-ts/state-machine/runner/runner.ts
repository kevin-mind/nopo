import type { GitHub } from "@actions/github/lib/utils.js";
import * as core from "@actions/core";
import * as fs from "fs";
import type { Action, ActionType, TokenType } from "../schemas/index.js";
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
  executeAssignUser,
  executeCreateSubIssues,
  executeCreatePR,
  executeConvertPRToDraft,
  executeMarkPRReady,
  executeRequestReview,
  executeMergePR,
  executeSubmitReview,
  executeRemoveReviewer,
  executeResetIssue,
} from "./executors/github.js";
import { executeCreateBranch, executeGitPush } from "./executors/git.js";
import { executeRunClaude } from "./executors/claude.js";
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
import { executeApplyTriageOutput } from "./executors/triage.js";
import { executeApplyIterateOutput } from "./executors/iterate.js";
import { executeApplyReviewOutput } from "./executors/review.js";
import { executeApplyPRResponseOutput } from "./executors/pr-response.js";
import { executeAppendAgentNotes } from "./executors/agent-notes.js";
import {
  signalStart,
  signalEnd,
  type ResourceType,
  type ProgressInfo,
  type JobResult,
} from "./signaler.js";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// Types
// ============================================================================

/**
 * Context for action execution
 *
 * Supports two octokits for different token types:
 * - octokit (code token): For code operations (push, PR, project fields)
 * - reviewOctokit (review token): For review operations (submit reviews)
 */
/**
 * Mock outputs for Claude prompts (used in test mode to skip real Claude calls)
 */
interface MockOutputs {
  triage?: Record<string, unknown>;
  iterate?: Record<string, unknown>;
  review?: Record<string, unknown>;
  comment?: Record<string, unknown>;
  "review-response"?: Record<string, unknown>;
  [key: string]: Record<string, unknown> | undefined;
}

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
}

/**
 * Extended context for signaled execution
 * Includes all information needed for status comments
 */
interface SignaledRunnerContext extends RunnerContext {
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

// Re-export types from signaler;

/**
 * Get the appropriate octokit based on the action's token field
 */
function getOctokitForAction(action: Action, ctx: RunnerContext): Octokit {
  const tokenType: TokenType = action.token || "code";
  if (tokenType === "review" && ctx.reviewOctokit) {
    return ctx.reviewOctokit;
  }
  return ctx.octokit;
}

/**
 * Result of executing a single action
 */
interface ActionResult {
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
interface ActionChainContext {
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
 * Options for the runner
 */
interface RunnerOptions {
  stopOnError?: boolean;
  logActions?: boolean;
}

// ============================================================================
// Runner Implementation
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
    return chainCtx.lastClaudeStructuredOutput;
  }

  // Check if action has a filePath for artifact-based execution
  const actionWithFile = action as Action & { filePath?: string };
  if (actionWithFile.filePath && fs.existsSync(actionWithFile.filePath)) {
    try {
      const content = fs.readFileSync(actionWithFile.filePath, "utf-8");
      const parsed = JSON.parse(content);
      core.info(`Loaded structured output from file: ${actionWithFile.filePath}`);
      return parsed;
    } catch (e) {
      core.warning(`Failed to read structured output from ${actionWithFile.filePath}: ${e}`);
    }
  }

  return undefined;
}

/**
 * Execute a single action
 *
 * Creates a context with the appropriate octokit based on action.token
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
      return executeUpdateProjectStatus(action, actionCtx);
    case "incrementIteration":
      return executeIncrementIteration(action, actionCtx);
    case "recordFailure":
      return executeRecordFailure(action, actionCtx);
    case "clearFailures":
      return executeClearFailures(action, actionCtx);
    case "block":
      return executeBlock(action, actionCtx);

    // Issue actions
    case "closeIssue":
      return executeCloseIssue(action, actionCtx);
    case "reopenIssue":
      // reopenIssue is part of resetIssue compound action
      core.info(`Reopen issue #${action.issueNumber} - handled by resetIssue`);
      return { reopened: true };
    case "resetIssue":
      return executeResetIssue(action, actionCtx);
    case "appendHistory":
      return executeAppendHistory(action, actionCtx);
    case "updateHistory":
      return executeUpdateHistory(action, actionCtx);
    case "updateIssueBody":
      return executeUpdateIssueBody(action, actionCtx);
    case "addComment":
      return executeAddComment(action, actionCtx);
    case "unassignUser":
      return executeUnassignUser(action, actionCtx);
    case "assignUser":
      return executeAssignUser(action, actionCtx);
    case "createSubIssues":
      return executeCreateSubIssues(action, actionCtx);

    // Git actions
    case "createBranch":
      return executeCreateBranch(action, actionCtx);
    case "gitPush":
      return executeGitPush(action, actionCtx);

    // PR actions
    case "createPR":
      return executeCreatePR(action, actionCtx);
    case "convertPRToDraft":
      return executeConvertPRToDraft(action, actionCtx);
    case "markPRReady":
      return executeMarkPRReady(action, actionCtx);
    case "requestReview":
      return executeRequestReview(action, actionCtx);
    case "mergePR":
      return executeMergePR(action, actionCtx);
    case "submitReview":
      return executeSubmitReview(action, actionCtx);
    case "removeReviewer":
      return executeRemoveReviewer(action, actionCtx);

    // Claude actions - handled directly by workflow via run-claude action
    // The executor should never receive runClaude actions (workflow filters them)
    case "runClaude":
      return executeRunClaude(action, actionCtx);

    // Discussion actions
    case "addDiscussionComment":
      return executeAddDiscussionComment(action, actionCtx);
    case "updateDiscussionBody":
      return executeUpdateDiscussionBody(action, actionCtx);
    case "addDiscussionReaction":
      return executeAddDiscussionReaction(action, actionCtx);
    case "createIssuesFromDiscussion":
      return executeCreateIssuesFromDiscussion(action, actionCtx);

    // Triage actions
    case "applyTriageOutput":
      // Get structured output from chain context or artifact file
      return executeApplyTriageOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Iterate actions
    case "applyIterateOutput":
      // Get structured output from chain context or artifact file
      return executeApplyIterateOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Agent notes actions
    case "appendAgentNotes":
      return executeAppendAgentNotes(action, actionCtx);

    // Review actions
    case "applyReviewOutput":
      // Get structured output from chain context or artifact file
      return executeApplyReviewOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // PR response actions
    case "applyPRResponseOutput":
      // Get structured output from chain context or artifact file
      return executeApplyPRResponseOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

    // Discussion apply actions
    case "applyDiscussionResearchOutput":
      return executeApplyDiscussionResearchOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );
    case "applyDiscussionRespondOutput":
      return executeApplyDiscussionRespondOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );
    case "applyDiscussionSummarizeOutput":
      return executeApplyDiscussionSummarizeOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );
    case "applyDiscussionPlanOutput":
      return executeApplyDiscussionPlanOutput(
        action,
        actionCtx,
        getStructuredOutput(action, chainCtx),
      );

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
    /** Octokit for review operations (uses different token) */
    reviewOctokit?: Octokit;
    /** Mock outputs for Claude calls (test mode) */
    mockOutputs?: MockOutputs;
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

// ============================================================================
// Signaled Execution
// ============================================================================

/**
 * Result of signaled execution
 * Includes the status comment ID for reference
 */
interface SignaledRunnerResult extends RunnerResult {
  /** ID of the status comment created (string for discussions, numeric string for issues/PRs) */
  statusCommentId: string;
}

/**
 * Execute actions with automatic status signaling
 *
 * 1. Posts a "loading" status comment before execution
 * 2. Executes all actions
 * 3. Updates the status comment with success/failure/cancelled
 *
 * This replaces the separate signal-start and handle-result jobs.
 */
async function runWithSignaling(
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
      const jobResult: JobResult = result.success ? "success" : "failure";
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
 * Create a signaled runner context from GitHub action inputs
 */
function createSignaledRunnerContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  projectNumber: number,
  resourceType: ResourceType,
  resourceNumber: number,
  job: string,
  runUrl: string,
  options: {
    dryRun?: boolean;
    serverUrl?: string;
    reviewOctokit?: Octokit;
    triggerCommentId?: string;
    progress?: ProgressInfo;
    /** Mock outputs for Claude calls (test mode) */
    mockOutputs?: MockOutputs;
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
