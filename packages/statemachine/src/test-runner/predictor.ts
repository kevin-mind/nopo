/**
 * State prediction using XState machine
 *
 * Predicts what state the machine should transition to based on current context
 */

import { createActor } from "xstate";
import type { MachineContext } from "../schemas/index.js";
import { issueMachine } from "../machines/issues/index.js";
import type { PredictedState } from "./types.js";

/**
 * States that wait for external events
 */
const WAITING_STATES: Record<string, { triggers: string[]; waitMs: number }> = {
  iterating: {
    triggers: ["CI_SUCCESS", "CI_FAILURE"],
    waitMs: 180000, // 3 minutes for CI
  },
  iteratingFix: {
    triggers: ["CI_SUCCESS", "CI_FAILURE"],
    waitMs: 180000,
  },
  reviewing: {
    triggers: ["REVIEW_APPROVED", "REVIEW_CHANGES_REQUESTED"],
    waitMs: 120000, // 2 minutes for review
  },
  orchestrating: {
    triggers: ["SUB_ISSUE_COMPLETE"],
    waitMs: 60000,
  },
  orchestrationWaiting: {
    triggers: ["SUB_ISSUE_COMPLETE"],
    waitMs: 60000,
  },
  triaging: {
    triggers: [],
    waitMs: 60000, // Triage is quick
  },
  commenting: {
    triggers: [],
    waitMs: 60000,
  },
  prReviewing: {
    triggers: [],
    waitMs: 120000,
  },
  prResponding: {
    triggers: ["CI_SUCCESS", "CI_FAILURE"],
    waitMs: 180000,
  },
  prRespondingHuman: {
    triggers: ["CI_SUCCESS", "CI_FAILURE"],
    waitMs: 180000,
  },
};

/**
 * State descriptions for user-friendly output
 */
const STATE_DESCRIPTIONS: Record<string, string> = {
  detecting: "Detecting initial state and determining next action",
  iterating: "Claude is implementing the issue",
  iteratingFix: "Claude is fixing CI failures",
  reviewing: "PR is under review",
  orchestrating: "Managing multi-phase work",
  orchestrationWaiting: "Waiting for current phase review to complete",
  orchestrationRunning: "Running orchestration actions",
  orchestrationComplete: "All phases are complete",
  triaging: "Triaging the issue (labeling, sizing)",
  commenting: "Responding to @claude mention",
  prReviewing: "Claude is reviewing the PR",
  prResponding: "Claude is responding to review feedback",
  prRespondingHuman: "Claude is responding to human review",
  processingCI: "Processing CI completion event",
  processingReview: "Processing review submission",
  transitioningToReview: "Transitioning PR to review state",
  initializing: "Initializing multi-phase work",
  blocked: "Issue is blocked (circuit breaker triggered)",
  error: "Issue is in error state",
  done: "All work is complete",
  mergeQueueLogging: "Logging merge queue entry",
  mergeQueueFailureLogging: "Logging merge queue failure",
  mergedLogging: "Logging PR merge",
  deployedStageLogging: "Logging stage deployment",
  deployedProdLogging: "Logging production deployment",
};

/**
 * Map project status to expected state
 */
export function statusToExpectedState(status: string | null): string {
  switch (status) {
    case "Backlog":
      return "detecting";
    case "In progress":
      return "iterating";
    case "In review":
      return "reviewing";
    case "Done":
      return "done";
    case "Blocked":
      return "blocked";
    case "Error":
      return "error";
    default:
      return "detecting";
  }
}

/**
 * Predict the next state based on current machine context
 *
 * Uses XState to simulate the machine and determine what state it would transition to
 */
export function predictNextState(context: MachineContext): PredictedState {
  // Create an actor with the context
  const actor = createActor(issueMachine, {
    input: context,
  });

  // Start the actor, then send DETECT event to trigger ONE state transition
  // Uses event-based transitions instead of `always` to ensure single transitions
  actor.start();
  actor.send({ type: "DETECT" });

  // Get the final snapshot after transitions
  const snapshot = actor.getSnapshot();

  // Stop the actor
  actor.stop();

  // Get the state value (handle compound states)
  const stateValue = snapshot.value;
  const expectedState =
    typeof stateValue === "string"
      ? stateValue
      : Object.keys(stateValue)[0] || "detecting";

  // Get waiting state info
  const waitingInfo = WAITING_STATES[expectedState] || {
    triggers: [],
    waitMs: 60000,
  };

  // Determine expected project status based on actions
  const pendingActions = snapshot.context.pendingActions || [];
  let expectedStatus = context.issue.projectStatus;

  for (const action of pendingActions) {
    if (action.type === "updateProjectStatus") {
      expectedStatus = action.status;
    }
  }

  return {
    expectedState,
    expectedStatus,
    triggersNeeded: waitingInfo.triggers,
    estimatedWaitMs: waitingInfo.waitMs,
    description: STATE_DESCRIPTIONS[expectedState] || expectedState,
  };
}

/**
 * Check if a state is terminal (no more work to do)
 */
export function isTerminalState(state: string): boolean {
  return state === "done" || state === "blocked" || state === "error";
}

/**
 * Check if a state is a final state (XState final node - run completes)
 */
export function isFinalState(state: string): boolean {
  // These states have type: "final" in the machine
  return [
    "done",
    "blocked",
    "error",
    "triaging",
    "commenting",
    "prReviewing",
    "prResponding",
    "prRespondingHuman",
    "iterating",
    "iteratingFix",
    "reviewing",
    "orchestrationRunning",
    "orchestrationWaiting",
    "orchestrationComplete",
    "mergeQueueLogging",
    "mergeQueueFailureLogging",
    "mergedLogging",
    "deployedStageLogging",
    "deployedProdLogging",
  ].includes(state);
}

/**
 * Get the expected state after an issue is triggered
 *
 * This is useful for predicting what state the machine should reach
 * after a workflow is triggered
 */
export function getExpectedStateAfterTrigger(
  context: MachineContext,
): PredictedState {
  // The prediction already simulates the machine
  // This just provides a cleaner API
  return predictNextState(context);
}

/**
 * Get status from state value (for matching against project status)
 */
export function stateToStatus(state: string): string | null {
  switch (state) {
    case "iterating":
    case "iteratingFix":
    case "orchestrating":
    case "orchestrationRunning":
      return "In progress";
    case "reviewing":
    case "orchestrationWaiting":
      return "In review";
    case "done":
    case "orchestrationComplete":
      return "Done";
    case "blocked":
      return "Blocked";
    case "error":
      return "Error";
    default:
      return null;
  }
}
