/**
 * Exponential backoff polling utility
 */

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

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Poll until a condition is met or timeout
 *
 * @param fetchFn Function to fetch data
 * @param conditionFn Function to check if condition is met
 * @param config Polling configuration
 * @param onPoll Optional callback after each poll (for logging)
 * @returns Poll result with success status and final data
 */
export async function pollUntil<T>(
  fetchFn: () => Promise<T>,
  conditionFn: (data: T) => boolean,
  config: Partial<PollerConfig> = {},
  onPoll?: (data: T, attempt: number, elapsed: number) => void,
): Promise<PollResult<T>> {
  const fullConfig: PollerConfig = {
    ...DEFAULT_POLLER_CONFIG,
    ...config,
  };

  const startTime = Date.now();
  let attempts = 0;
  let interval = fullConfig.initialIntervalMs;
  let lastData: T | null = null;

  while (Date.now() - startTime < fullConfig.timeoutMs) {
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

      // Sleep for the shorter of interval or remaining time
      await sleep(Math.min(sleepTime, remainingTime));
    } catch {
      // On error, continue polling with backoff
      const sleepTime = calculateNextInterval(interval, fullConfig);
      interval = sleepTime;

      const remainingTime = fullConfig.timeoutMs - (Date.now() - startTime);
      if (remainingTime <= 0) {
        break;
      }

      await sleep(Math.min(sleepTime, remainingTime));
    }
  }

  // Timeout reached
  return {
    success: false,
    data: lastData,
    attempts,
    totalTimeMs: Date.now() - startTime,
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
