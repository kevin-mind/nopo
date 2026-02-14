/**
 * Runner Types
 *
 * Types for the action execution runtime.
 */

import type { GitHub } from "@actions/github/lib/utils.js";
import type { Action, TokenType } from "../schemas/actions/index.js";

export type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// Mock Support
// ============================================================================

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

// ============================================================================
// Runner Context
// ============================================================================

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

// ============================================================================
// Signaler Types
// ============================================================================

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

// ============================================================================
// Action Results
// ============================================================================

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
 * Options for the runner
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
