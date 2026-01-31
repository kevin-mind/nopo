/**
 * Exponential backoff polling utility with cancellation support
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import type { PollerConfig, PollResult } from "./types.js";

/**
 * Default polling configuration
 */
export const DEFAULT_POLLER_CONFIG: PollerConfig = {
  initialIntervalMs: 5000,
  maxIntervalMs: 60000,
  multiplier: 1.5,
  jitterFactor: 0.1,
  timeoutMs: 300000, // 5 minutes default
};

// Global abort controller for graceful shutdown
let globalAbortController: AbortController | null = null;

// Store the current workflow run ID for cancellation checking
let currentWorkflowRunId: string | null = null;

/**
 * Setup signal handlers for graceful cancellation
 */
export function setupCancellationHandlers(): AbortController {
  globalAbortController = new AbortController();

  // Store the workflow run ID from environment
  currentWorkflowRunId = process.env.GITHUB_RUN_ID || null;
  if (currentWorkflowRunId) {
    core.debug(`Cancellation handler: tracking run ${currentWorkflowRunId}`);
  }

  const handleSignal = (signal: string) => {
    core.info(`\n⚠️  Received ${signal} signal - cancelling polling...`);
    globalAbortController?.abort();
  };

  // Handle SIGINT (Ctrl+C) and SIGTERM (workflow cancellation)
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  return globalAbortController;
}

/**
 * Check if the current workflow run has been cancelled via GitHub API
 * This is more reliable than signal handlers in containerized environments
 */
async function isWorkflowCancelled(): Promise<boolean> {
  if (!currentWorkflowRunId) {
    return false;
  }

  const repoFullName = process.env.GITHUB_REPOSITORY;
  if (!repoFullName) {
    return false;
  }

  try {
    let stdout = "";
    const exitCode = await exec.exec(
      "gh",
      [
        "api",
        `repos/${repoFullName}/actions/runs/${currentWorkflowRunId}`,
        "--jq",
        ".status",
      ],
      {
        listeners: {
          stdout: (data) => {
            stdout += data.toString();
          },
        },
        silent: true,
        ignoreReturnCode: true,
      },
    );

    if (exitCode !== 0) {
      return false;
    }

    const status = stdout.trim();
    // If status is not "in_progress", workflow was cancelled or completed elsewhere
    if (status === "cancelled" || status === "completed") {
      core.info(`🛑 Workflow run ${currentWorkflowRunId} status: ${status}`);
      return true;
    }

    return false;
  } catch {
    // If we can't check, assume not cancelled
    return false;
  }
}

/**
 * Get the global abort signal
 */
function getAbortSignal(): AbortSignal | undefined {
  return globalAbortController?.signal;
}

/**
 * Sleep for a specified duration with cancellation support
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Polling cancelled"));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        reject(new Error("Polling cancelled"));
      },
      { once: true },
    );
  });
}

/**
 * Calculate next interval with exponential backoff and jitter
 */
function calculateNextInterval(
  currentInterval: number,
  config: PollerConfig,
): number {
  // Apply exponential backoff
  let nextInterval = currentInterval * config.multiplier;

  // Cap at max interval
  nextInterval = Math.min(nextInterval, config.maxIntervalMs);

  // Add jitter (random variation to prevent thundering herd)
  const jitterRange = nextInterval * config.jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  nextInterval = Math.max(1000, nextInterval + jitter); // Minimum 1 second

  return nextInterval;
}

/**
 * Poll until a condition is met, timeout, or cancellation
 *
 * @param fetchFn Function to fetch data
 * @param conditionFn Function to check if condition is met
 * @param config Polling configuration
 * @param onPoll Optional callback after each poll (for logging)
 * @param signal Optional AbortSignal for cancellation
 * @returns Poll result with success status and final data
 */
export async function pollUntil<T>(
  fetchFn: () => Promise<T>,
  conditionFn: (data: T) => boolean,
  config: Partial<PollerConfig> = {},
  onPoll?: (data: T, attempt: number, elapsed: number) => void,
  signal?: AbortSignal,
): Promise<PollResult<T>> {
  const fullConfig: PollerConfig = {
    ...DEFAULT_POLLER_CONFIG,
    ...config,
  };

  // Use provided signal or global signal
  const abortSignal = signal || getAbortSignal();

  const startTime = Date.now();
  let attempts = 0;
  let interval = fullConfig.initialIntervalMs;
  let lastData: T | null = null;
  let cancelled = false;

  while (Date.now() - startTime < fullConfig.timeoutMs) {
    // Check for cancellation via signal
    if (abortSignal?.aborted) {
      cancelled = true;
      core.info("🛑 Polling cancelled by signal");
      break;
    }

    // Check for cancellation via GitHub API on every attempt
    // This catches cases where signals don't propagate properly in containers
    const workflowCancelled = await isWorkflowCancelled();
    if (workflowCancelled) {
      cancelled = true;
      core.info("🛑 Polling cancelled - workflow run no longer in progress");
      globalAbortController?.abort();
      break;
    }

    attempts++;

    try {
      const data = await fetchFn();
      lastData = data;

      // Call progress callback
      if (onPoll) {
        onPoll(data, attempts, Date.now() - startTime);
      }

      // Check if condition is met
      if (conditionFn(data)) {
        return {
          success: true,
          data,
          attempts,
          totalTimeMs: Date.now() - startTime,
        };
      }

      // Calculate next interval with backoff
      const sleepTime = calculateNextInterval(interval, fullConfig);
      interval = sleepTime;

      // Check if we'll exceed timeout
      const remainingTime = fullConfig.timeoutMs - (Date.now() - startTime);
      if (remainingTime <= 0) {
        break;
      }

      // Sleep for the shorter of interval or remaining time (with cancellation support)
      try {
        await sleep(Math.min(sleepTime, remainingTime), abortSignal);
      } catch {
        // Sleep was cancelled
        cancelled = true;
        core.info("🛑 Polling cancelled during sleep");
        break;
      }
    } catch (error) {
      // Check if this was a cancellation
      if (abortSignal?.aborted) {
        cancelled = true;
        core.info("🛑 Polling cancelled");
        break;
      }

      // Log the error so we can see what's happening
      const errorMsg = error instanceof Error ? error.message : String(error);
      core.warning(
        `[${attempts}] Poll error: ${errorMsg.slice(0, 200)}${errorMsg.length > 200 ? "..." : ""}`,
      );

      // On error, continue polling with backoff
      const sleepTime = calculateNextInterval(interval, fullConfig);
      interval = sleepTime;

      const remainingTime = fullConfig.timeoutMs - (Date.now() - startTime);
      if (remainingTime <= 0) {
        break;
      }

      try {
        await sleep(Math.min(sleepTime, remainingTime), abortSignal);
      } catch {
        cancelled = true;
        break;
      }
    }
  }

  // Return result
  return {
    success: false,
    data: lastData,
    attempts,
    totalTimeMs: Date.now() - startTime,
    cancelled,
  };
}

/**
 * Poll until state changes from the initial state
 * Useful for waiting for any state transition
 * @internal Reserved for future use
 */
async function _pollUntilStateChanges<T>(
  fetchFn: () => Promise<T>,
  getState: (data: T) => string | null,
  initialState: string | null,
  config: Partial<PollerConfig> = {},
  onPoll?: (data: T, attempt: number, elapsed: number) => void,
): Promise<PollResult<T>> {
  return pollUntil(
    fetchFn,
    (data) => {
      const currentState = getState(data);
      return currentState !== initialState;
    },
    config,
    onPoll,
  );
}

/**
 * Poll until a specific state is reached
 * @internal Reserved for future use
 */
async function _pollUntilState<T>(
  fetchFn: () => Promise<T>,
  getState: (data: T) => string | null,
  targetState: string,
  config: Partial<PollerConfig> = {},
  onPoll?: (data: T, attempt: number, elapsed: number) => void,
): Promise<PollResult<T>> {
  return pollUntil(
    fetchFn,
    (data) => getState(data) === targetState,
    config,
    onPoll,
  );
}

/**
 * Poll until one of several states is reached
 * @internal Reserved for future use
 */
async function _pollUntilAnyState<T>(
  fetchFn: () => Promise<T>,
  getState: (data: T) => string | null,
  targetStates: string[],
  config: Partial<PollerConfig> = {},
  onPoll?: (data: T, attempt: number, elapsed: number) => void,
): Promise<PollResult<T>> {
  return pollUntil(
    fetchFn,
    (data) => {
      const state = getState(data);
      return state !== null && targetStates.includes(state);
    },
    config,
    onPoll,
  );
}

// Keep references to avoid lint errors for reserved functions
void _pollUntilStateChanges;
void _pollUntilState;
void _pollUntilAnyState;
