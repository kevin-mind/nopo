/**
 * Runner States — shared predict-execute-verify action runner.
 *
 * These XState state nodes handle the mechanics of:
 * 1. Popping actions from the queue
 * 2. Running predict (synchronous)
 * 3. Running execute (async, via invoke)
 * 4. Running verify (async — refreshes context, then checks)
 * 5. Recording results and looping until queue is empty or limit reached
 *
 * Domain machines compose these via createDomainMachine().
 */

/**
 * State node IDs used by the runner.
 * Domain machines should target 'executingQueue' to hand off to the runner.
 */
export const RUNNER_STATES = {
  executingQueue: "executingQueue",
  executingBatch: "executingBatch",
  persistingBatch: "persistingBatch",
  refreshingContext: "refreshingContext",
  verifyingBatch: "verifyingBatch",
  queueComplete: "queueComplete",
  executionFailed: "executionFailed",
  verificationFailed: "verificationFailed",
  done: "done",
} as const;

export type RunnerState = (typeof RUNNER_STATES)[keyof typeof RUNNER_STATES];
