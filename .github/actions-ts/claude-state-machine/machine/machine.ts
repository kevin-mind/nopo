import { setup, assign } from "xstate";
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
  emitCreateBranch,
  emitCreatePR,
  emitRunClaude,
  emitRunClaudeFixCI,
  emitRunClaudeTriage,
  emitRunClaudeComment,
  emitRunClaudePRReview,
  emitRunClaudePRResponse,
  emitRunClaudePRHumanResponse,
  emitMarkReady,
  emitRequestReview,
  emitConvertToDraft,
  emitTransitionToReview,
  emitHandleCIFailure,
  emitBlockIssue,
  emitOrchestrate,
  emitAllPhasesDone,
  emitLog,
  emitStop,
} from "./actions.js";

/**
 * Extended context that includes accumulated actions
 */
interface MachineContextWithActions extends MachineContext {
  pendingActions: Action[];
}

/**
 * Machine events
 */
type MachineEvent =
  | { type: "START" }
  | { type: "CI_SUCCESS" }
  | { type: "CI_FAILURE" }
  | { type: "REVIEW_APPROVED" }
  | { type: "REVIEW_CHANGES_REQUESTED" }
  | { type: "REVIEW_COMMENTED" }
  | { type: "PR_MERGED" }
  | { type: "CONTINUE" };

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
    currentPhaseNeedsWork: ({ context }) =>
      guards.currentPhaseNeedsWork({ context }),
    currentPhaseInReview: ({ context }) =>
      guards.currentPhaseInReview({ context }),
    todosDone: ({ context }) => guards.todosDone({ context }),
    maxFailuresReached: ({ context }) => guards.maxFailuresReached({ context }),
    ciPassed: ({ context }) => guards.ciPassed({ context }),
    ciFailed: ({ context }) => guards.ciFailed({ context }),
    reviewApproved: ({ context }) => guards.reviewApproved({ context }),
    reviewRequestedChanges: ({ context }) =>
      guards.reviewRequestedChanges({ context }),
    readyForReview: ({ context }) => guards.readyForReview({ context }),
    shouldContinueIterating: ({ context }) =>
      guards.shouldContinueIterating({ context }),
    shouldBlock: ({ context }) => guards.shouldBlock({ context }),
    hasPR: ({ context }) => guards.hasPR({ context }),
    prIsDraft: ({ context }) => guards.prIsDraft({ context }),
    hasBranch: ({ context }) => guards.hasBranch({ context }),
    triggeredByCI: ({ context }) => guards.triggeredByCI({ context }),
    triggeredByReview: ({ context }) => guards.triggeredByReview({ context }),
    triggeredByTriage: ({ context }) => guards.triggeredByTriage({ context }),
    triggeredByComment: ({ context }) => guards.triggeredByComment({ context }),
    triggeredByOrchestrate: ({ context }) =>
      guards.triggeredByOrchestrate({ context }),
    triggeredByPRReview: ({ context }) =>
      guards.triggeredByPRReview({ context }),
    triggeredByPRResponse: ({ context }) =>
      guards.triggeredByPRResponse({ context }),
    triggeredByPRHumanResponse: ({ context }) =>
      guards.triggeredByPRHumanResponse({ context }),
    needsTriage: ({ context }) => guards.needsTriage({ context }),
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
          emitLog(
            { context },
            `Starting iteration ${context.issue.iteration + 1}`,
          ),
        ),
    }),
    logReviewing: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, "PR is under review"),
        ),
    }),
    logTriaging: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, `Triaging issue #${context.issue.number}`),
        ),
    }),
    logCommenting: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog(
            { context },
            `Responding to comment on #${context.issue.number}`,
          ),
        ),
    }),
    logWaitingForReview: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, "Waiting for review on current phase"),
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
        accumulateActions(
          context.pendingActions,
          emitSetInProgress({ context }),
        ),
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
        accumulateActions(
          context.pendingActions,
          emitRecordFailure({ context }),
        ),
    }),
    clearFailures: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitClearFailures({ context }),
        ),
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

    // Git actions
    createBranch: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitCreateBranch({ context }),
        ),
    }),

    // Claude actions
    runClaude: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitRunClaude({ context })),
    }),
    runClaudeFixCI: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudeFixCI({ context }),
        ),
    }),
    runClaudeTriage: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudeTriage({ context }),
        ),
    }),
    runClaudeComment: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudeComment({ context }),
        ),
    }),

    // PR actions
    createPR: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitCreatePR({ context })),
    }),
    markPRReady: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitMarkReady({ context })),
    }),
    requestReview: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRequestReview({ context }),
        ),
    }),
    convertToDraft: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitConvertToDraft({ context }),
        ),
    }),
    runClaudePRReview: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudePRReview({ context }),
        ),
    }),
    runClaudePRResponse: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudePRResponse({ context }),
        ),
    }),
    runClaudePRHumanResponse: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudePRHumanResponse({ context }),
        ),
    }),
    logPRReviewing: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog(
            { context },
            `Reviewing PR #${context.pr?.number ?? "unknown"}`,
          ),
        ),
    }),
    logPRResponding: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog(
            { context },
            `Responding to review on PR #${context.pr?.number ?? "unknown"}`,
          ),
        ),
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

    // Orchestration actions
    orchestrate: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitOrchestrate({ context })),
    }),
    allPhasesDone: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitAllPhasesDone({ context }),
        ),
    }),
    logOrchestrating: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog(
            { context },
            `Orchestrating issue #${context.issue.number} (phase ${context.currentPhase}/${context.totalPhases})`,
          ),
        ),
    }),

    // Stop action
    stopWithReason: assign({
      pendingActions: ({ context }, params: { reason: string }) =>
        accumulateActions(
          context.pendingActions,
          emitStop({ context }, params.reason),
        ),
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
        // Check if this is a triage request
        {
          target: "triaging",
          guard: "triggeredByTriage",
        },
        // Check if this is a comment (@claude mention)
        {
          target: "commenting",
          guard: "triggeredByComment",
        },
        // Check if this is an orchestration request
        {
          target: "orchestrating",
          guard: "triggeredByOrchestrate",
        },
        // Check if this is a PR review request (bot should review)
        {
          target: "prReviewing",
          guard: "triggeredByPRReview",
        },
        // Check if this is a PR response (bot responds to bot's review)
        {
          target: "prResponding",
          guard: "triggeredByPRResponse",
        },
        // Check if this is a PR human response (bot responds to human's review)
        {
          target: "prRespondingHuman",
          guard: "triggeredByPRHumanResponse",
        },
        // Check if this is a CI completion event
        {
          target: "processingCI",
          guard: "triggeredByCI",
        },
        // Check if this is a review submission event (for orchestration)
        {
          target: "processingReview",
          guard: "triggeredByReview",
        },
        // Check if issue needs triage (no "triaged" label)
        // This ensures untriaged issues get triaged before any work begins
        {
          target: "triaging",
          guard: "needsTriage",
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
     * Triage an issue - analyze, label, create sub-issues
     */
    triaging: {
      entry: ["logTriaging", "runClaudeTriage"],
      type: "final",
    },

    /**
     * Respond to a comment (@claude mention)
     */
    commenting: {
      entry: ["logCommenting", "runClaudeComment"],
      type: "final",
    },

    /**
     * Bot reviews a PR
     *
     * Claude analyzes the PR and writes review-output.json.
     * The runner then submits the review via GitHub API.
     */
    prReviewing: {
      entry: ["logPRReviewing", "runClaudePRReview"],
      type: "final",
    },

    /**
     * Bot responds to its own (or another bot's) review feedback
     *
     * Claude addresses review comments and pushes changes.
     */
    prResponding: {
      entry: ["logPRResponding", "runClaudePRResponse"],
      type: "final",
    },

    /**
     * Bot responds to human review feedback
     *
     * Claude addresses human reviewer's comments and pushes changes.
     */
    prRespondingHuman: {
      entry: ["logPRResponding", "runClaudePRHumanResponse"],
      type: "final",
    },

    /**
     * Create sub-issues for phased work
     */
    initializing: {
      entry: ["setInProgress"],
      always: "orchestrating",
    },

    /**
     * Manage multi-phase work (parent issue orchestration)
     *
     * This state handles parent issues with sub-issues:
     * - If all phases done: emit completion actions
     * - If current phase in review: wait (no-op, review completion triggers next run)
     * - Otherwise: emit orchestration actions (init, advance, assign sub-issue)
     *
     * After emitting actions, this becomes a final state because:
     * - Sub-issue iteration happens in a separate workflow run
     * - Orchestration triggers sub-issue assignment which triggers iteration
     */
    orchestrating: {
      entry: ["logOrchestrating"],
      always: [
        // All phases complete - mark parent done
        {
          target: "orchestrationComplete",
          guard: "allPhasesDone",
        },
        // Current phase is in review - wait for review to complete
        {
          target: "orchestrationWaiting",
          guard: "currentPhaseInReview",
        },
        // Otherwise, run orchestration (init, advance, assign)
        {
          target: "orchestrationRunning",
        },
      ],
    },

    /**
     * Orchestration running - emits actions and stops
     */
    orchestrationRunning: {
      entry: ["orchestrate"],
      type: "final",
    },

    /**
     * Waiting for current phase review to complete
     */
    orchestrationWaiting: {
      entry: ["logWaitingForReview"],
      type: "final",
    },

    /**
     * All phases complete
     */
    orchestrationComplete: {
      entry: ["allPhasesDone"],
      type: "final",
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
        // NOTE: setWorking is NOT included here because iterating entry already calls it
        {
          target: "iterating",
          guard: "reviewRequestedChanges",
          actions: ["convertToDraft"],
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
      entry: [
        "createBranch",
        "setWorking",
        "incrementIteration",
        "logIterating",
        "runClaude",
        "createPR",
      ],
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
      entry: [
        "createBranch",
        "incrementIteration",
        "runClaudeFixCI",
        "createPR",
      ],
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
        // NOTE: setWorking NOT included - iterating entry already calls it
        REVIEW_CHANGES_REQUESTED: {
          target: "iterating",
          actions: ["convertToDraft"],
        },
        REVIEW_COMMENTED: "reviewing",
      },
      type: "final",
    },

    /**
     * Circuit breaker triggered
     * NOTE: Entry actions removed - blockIssue action already emits setBlocked + unassign
     */
    blocked: {
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
