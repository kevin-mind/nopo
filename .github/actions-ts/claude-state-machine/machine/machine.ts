import { setup, assign, fromPromise } from "xstate";
import type { MachineContext, Action } from "../schemas/index.js";
import { guards } from "./guards.js";
import {
  emitSetWorking,
  emitSetReview,
  emitSetInProgress,
  emitSetDone,
  emitSetBlocked,
  emitIncrementIteration,
  emitRecordFailure,
  emitClearFailures,
  emitCloseIssue,
  emitUnassign,
  emitRunClaude,
  emitRunClaudeFixCI,
  emitMarkReady,
  emitRequestReview,
  emitConvertToDraft,
  emitTransitionToReview,
  emitHandleCIFailure,
  emitBlockIssue,
  emitLog,
  emitStop,
} from "./actions.js";

/**
 * Extended context that includes accumulated actions
 */
export interface MachineContextWithActions extends MachineContext {
  pendingActions: Action[];
}

/**
 * Machine events
 */
export type MachineEvent =
  | { type: "START" }
  | { type: "CI_SUCCESS" }
  | { type: "CI_FAILURE" }
  | { type: "REVIEW_APPROVED" }
  | { type: "REVIEW_CHANGES_REQUESTED" }
  | { type: "REVIEW_COMMENTED" }
  | { type: "PR_MERGED" }
  | { type: "CONTINUE" };

/**
 * State machine output - the actions to execute
 */
export interface MachineOutput {
  actions: Action[];
  finalState: string;
}

/**
 * Helper to accumulate actions into context
 */
function accumulateActions(
  existingActions: Action[],
  newActions: Action[],
): Action[] {
  return [...existingActions, ...newActions];
}

/**
 * The Claude automation state machine
 *
 * States:
 * - detecting: Initial state, determines what to do based on context
 * - initializing: Create sub-issues if needed, set up project fields
 * - orchestrating: Manage multi-phase work
 * - iterating: Claude working on implementation
 * - reviewing: PR under review
 * - blocked: Circuit breaker triggered
 * - error: Unrecoverable error
 * - done: All complete
 */
export const claudeMachine = setup({
  types: {
    context: {} as MachineContextWithActions,
    events: {} as MachineEvent,
    input: {} as MachineContext,
  },
  guards: {
    isAlreadyDone: ({ context }) => guards.isAlreadyDone({ context }),
    isBlocked: ({ context }) => guards.isBlocked({ context }),
    isError: ({ context }) => guards.isError({ context }),
    needsSubIssues: ({ context }) => guards.needsSubIssues({ context }),
    hasSubIssues: ({ context }) => guards.hasSubIssues({ context }),
    isInReview: ({ context }) => guards.isInReview({ context }),
    allPhasesDone: ({ context }) => guards.allPhasesDone({ context }),
    currentPhaseNeedsWork: ({ context }) => guards.currentPhaseNeedsWork({ context }),
    currentPhaseInReview: ({ context }) => guards.currentPhaseInReview({ context }),
    todosDone: ({ context }) => guards.todosDone({ context }),
    maxFailuresReached: ({ context }) => guards.maxFailuresReached({ context }),
    ciPassed: ({ context }) => guards.ciPassed({ context }),
    ciFailed: ({ context }) => guards.ciFailed({ context }),
    reviewApproved: ({ context }) => guards.reviewApproved({ context }),
    reviewRequestedChanges: ({ context }) => guards.reviewRequestedChanges({ context }),
    readyForReview: ({ context }) => guards.readyForReview({ context }),
    shouldContinueIterating: ({ context }) => guards.shouldContinueIterating({ context }),
    shouldBlock: ({ context }) => guards.shouldBlock({ context }),
    hasPR: ({ context }) => guards.hasPR({ context }),
    prIsDraft: ({ context }) => guards.prIsDraft({ context }),
    hasBranch: ({ context }) => guards.hasBranch({ context }),
    triggeredByCI: ({ context }) => guards.triggeredByCI({ context }),
    triggeredByReview: ({ context }) => guards.triggeredByReview({ context }),
  },
  actions: {
    // Log actions
    logDetecting: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, "Detecting initial state"),
        ),
    }),
    logIterating: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, `Starting iteration ${context.issue.iteration + 1}`),
        ),
    }),
    logReviewing: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, "PR is under review"),
        ),
    }),

    // Status actions
    setWorking: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitSetWorking({ context })),
    }),
    setReview: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitSetReview({ context })),
    }),
    setInProgress: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitSetInProgress({ context })),
    }),
    setDone: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitSetDone({ context })),
    }),
    setBlocked: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitSetBlocked({ context })),
    }),

    // Iteration actions
    incrementIteration: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitIncrementIteration({ context }),
        ),
    }),
    recordFailure: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitRecordFailure({ context })),
    }),
    clearFailures: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitClearFailures({ context })),
    }),

    // Issue actions
    closeIssue: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitCloseIssue({ context })),
    }),
    unassign: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitUnassign({ context })),
    }),

    // Claude actions
    runClaude: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitRunClaude({ context })),
    }),
    runClaudeFixCI: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitRunClaudeFixCI({ context })),
    }),

    // PR actions
    markPRReady: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitMarkReady({ context })),
    }),
    requestReview: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitRequestReview({ context })),
    }),
    convertToDraft: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitConvertToDraft({ context })),
    }),

    // Compound actions
    transitionToReview: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitTransitionToReview({ context }),
        ),
    }),
    handleCIFailure: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitHandleCIFailure({ context }),
        ),
    }),
    blockIssue: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitBlockIssue({ context })),
    }),

    // Stop action
    stopWithReason: assign({
      pendingActions: ({ context }, params: { reason: string }) =>
        accumulateActions(context.pendingActions, emitStop({ context }, params.reason)),
    }),
  },
}).createMachine({
  id: "claude-automation",
  initial: "detecting",
  context: ({ input }) => ({
    ...input,
    pendingActions: [],
  }),

  states: {
    /**
     * Initial state - determine what to do based on context
     */
    detecting: {
      entry: "logDetecting",
      always: [
        // Check terminal states first
        { target: "done", guard: "isAlreadyDone" },
        { target: "blocked", guard: "isBlocked" },
        { target: "error", guard: "isError" },
        // Check if this is a CI completion event
        {
          target: "processingCI",
          guard: "triggeredByCI",
        },
        // Check if this is a review event
        {
          target: "processingReview",
          guard: "triggeredByReview",
        },
        // Check for multi-phase work
        { target: "initializing", guard: "needsSubIssues" },
        { target: "orchestrating", guard: "hasSubIssues" },
        // Check current state
        { target: "reviewing", guard: "isInReview" },
        // Default to iterating
        { target: "iterating" },
      ],
    },

    /**
     * Create sub-issues for phased work
     */
    initializing: {
      entry: ["setInProgress"],
      always: "orchestrating",
    },

    /**
     * Manage multi-phase work
     */
    orchestrating: {
      always: [
        { target: "done", guard: "allPhasesDone" },
        { target: "reviewing", guard: "currentPhaseInReview" },
        { target: "iterating", guard: "currentPhaseNeedsWork" },
        // If no specific state, start working
        { target: "iterating" },
      ],
    },

    /**
     * Process CI completion
     */
    processingCI: {
      always: [
        // CI passed and todos done -> go to review
        {
          target: "transitioningToReview",
          guard: "readyForReview",
        },
        // CI passed but todos not done -> continue iterating
        {
          target: "iterating",
          guard: "ciPassed",
          actions: ["clearFailures"],
        },
        // CI failed and max failures -> block
        {
          target: "blocked",
          guard: "shouldBlock",
          actions: ["blockIssue"],
        },
        // CI failed -> iterate to fix
        {
          target: "iteratingFix",
          guard: "ciFailed",
          actions: ["handleCIFailure"],
        },
        // Fallback
        { target: "iterating" },
      ],
    },

    /**
     * Process review submission
     */
    processingReview: {
      always: [
        // Approved -> orchestrate (will advance phase or complete)
        {
          target: "orchestrating",
          guard: "reviewApproved",
        },
        // Changes requested -> iterate to address
        {
          target: "iterating",
          guard: "reviewRequestedChanges",
          actions: ["convertToDraft", "setWorking"],
        },
        // Just commented -> stay in review
        { target: "reviewing" },
      ],
    },

    /**
     * Transitioning to review state
     */
    transitioningToReview: {
      entry: ["transitionToReview"],
      always: "reviewing",
    },

    /**
     * Claude is working on implementation
     */
    iterating: {
      entry: ["setWorking", "incrementIteration", "logIterating", "runClaude"],
      on: {
        CI_SUCCESS: [
          {
            target: "transitioningToReview",
            guard: "todosDone",
          },
          {
            target: "iterating",
            actions: ["clearFailures"],
          },
        ],
        CI_FAILURE: [
          {
            target: "blocked",
            guard: "maxFailuresReached",
            actions: ["blockIssue"],
          },
          {
            target: "iteratingFix",
            actions: ["handleCIFailure"],
          },
        ],
      },
      // Auto-stop after entry actions (no event-driven transitions in initial run)
      type: "final",
    },

    /**
     * Claude is fixing CI failures
     */
    iteratingFix: {
      entry: ["incrementIteration", "runClaudeFixCI"],
      on: {
        CI_SUCCESS: [
          {
            target: "transitioningToReview",
            guard: "todosDone",
          },
          {
            target: "iterating",
            actions: ["clearFailures"],
          },
        ],
        CI_FAILURE: [
          {
            target: "blocked",
            guard: "maxFailuresReached",
            actions: ["blockIssue"],
          },
          {
            target: "iteratingFix",
            actions: ["handleCIFailure"],
          },
        ],
      },
      type: "final",
    },

    /**
     * PR is under review
     */
    reviewing: {
      entry: ["logReviewing"],
      on: {
        REVIEW_APPROVED: "orchestrating",
        REVIEW_CHANGES_REQUESTED: {
          target: "iterating",
          actions: ["convertToDraft", "setWorking"],
        },
        REVIEW_COMMENTED: "reviewing",
      },
      type: "final",
    },

    /**
     * Circuit breaker triggered
     */
    blocked: {
      entry: ["setBlocked", "unassign"],
      type: "final",
    },

    /**
     * Unrecoverable error
     */
    error: {
      type: "final",
    },

    /**
     * All work complete
     */
    done: {
      entry: ["setDone", "closeIssue"],
      type: "final",
    },
  },
});

/**
 * Get the initial event based on trigger type
 */
export function getTriggerEvent(context: MachineContext): MachineEvent {
  switch (context.trigger) {
    case "workflow_run_completed":
      if (context.ciResult === "success") {
        return { type: "CI_SUCCESS" };
      } else if (context.ciResult === "failure") {
        return { type: "CI_FAILURE" };
      }
      return { type: "START" };

    case "pr_review_submitted":
      switch (context.reviewDecision) {
        case "APPROVED":
          return { type: "REVIEW_APPROVED" };
        case "CHANGES_REQUESTED":
          return { type: "REVIEW_CHANGES_REQUESTED" };
        case "COMMENTED":
          return { type: "REVIEW_COMMENTED" };
        default:
          return { type: "START" };
      }

    default:
      return { type: "START" };
  }
}

/**
 * Type for the machine
 */
export type ClaudeMachine = typeof claudeMachine;
