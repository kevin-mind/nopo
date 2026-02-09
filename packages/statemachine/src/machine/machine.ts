import { setup, assign } from "xstate";
import type { MachineContext, Action } from "../schemas/index.js";
import { guards } from "./guards.js";
import {
  emitSetWorking,
  emitSetReview,
  emitSetInProgress,
  emitSetDone,
  emitSetBlocked,
  emitSetError,
  emitSetReady,
  emitLogInvalidIteration,
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
  emitMergePR,
  emitTransitionToReview,
  emitHandleCIFailure,
  emitBlockIssue,
  emitOrchestrate,
  emitAllPhasesDone,
  emitLog,
  emitStop,
  // Merge queue logging actions
  emitMergeQueueEntry,
  emitMergeQueueFailure,
  emitMerged,
  emitDeployedStage,
  emitDeployedProd,
  // Push to draft action
  emitPushToDraft,
  // Reset action
  emitResetIssue,
  // Grooming actions
  emitRunClaudeGrooming,
  // Pivot action
  emitRunClaudePivot,
  // Iteration history logging
  emitLogIterationStarted,
  emitLogCISuccess,
  emitLogReviewRequested,
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
  | { type: "DETECT" }
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions for machine type declarations
    context: {} as MachineContextWithActions,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions for machine type declarations
    events: {} as MachineEvent,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions for machine type declarations
    input: {} as MachineContext,
  },
  guards: {
    isAlreadyDone: ({ context }) => guards.isAlreadyDone({ context }),
    isBlocked: ({ context }) => guards.isBlocked({ context }),
    isError: ({ context }) => guards.isError({ context }),
    needsSubIssues: ({ context }) => guards.needsSubIssues({ context }),
    hasSubIssues: ({ context }) => guards.hasSubIssues({ context }),
    isSubIssue: ({ context }) => guards.isSubIssue({ context }),
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
    triggeredByPRReviewApproved: ({ context }) =>
      guards.triggeredByPRReviewApproved({ context }),
    triggeredByPRPush: ({ context }) => guards.triggeredByPRPush({ context }),
    triggeredByReset: ({ context }) => guards.triggeredByReset({ context }),
    triggeredByPivot: ({ context }) => guards.triggeredByPivot({ context }),
    // Merge queue logging guards
    triggeredByMergeQueueEntry: ({ context }) =>
      guards.triggeredByMergeQueueEntry({ context }),
    triggeredByMergeQueueFailure: ({ context }) =>
      guards.triggeredByMergeQueueFailure({ context }),
    triggeredByPRMerged: ({ context }) =>
      guards.triggeredByPRMerged({ context }),
    triggeredByDeployedStage: ({ context }) =>
      guards.triggeredByDeployedStage({ context }),
    triggeredByDeployedProd: ({ context }) =>
      guards.triggeredByDeployedProd({ context }),
    needsTriage: ({ context }) => guards.needsTriage({ context }),
    // Grooming guards
    triggeredByGroom: ({ context }) => guards.triggeredByGroom({ context }),
    triggeredByGroomSummary: ({ context }) =>
      guards.triggeredByGroomSummary({ context }),
    needsGrooming: ({ context }) => guards.needsGrooming({ context }),
    isGroomed: ({ context }) => guards.isGroomed({ context }),
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
    logFixingCI: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog(
            { context },
            `Fixing CI (iteration ${context.issue.iteration + 1})`,
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
    logAwaitingMerge: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog(
            { context },
            `PR #${context.pr?.number} marked ready for merge - awaiting human action`,
          ),
        ),
    }),

    // Iteration history logging (writes to issue body)
    historyIterationStarted: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogIterationStarted({ context }),
        ),
    }),
    historyCISuccess: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogCISuccess({ context }),
        ),
    }),
    historyReviewRequested: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogReviewRequested({ context }),
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
    setError: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitSetError({ context })),
    }),
    logInvalidIteration: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogInvalidIteration({ context }),
        ),
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
    mergePR: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitMergePR({ context })),
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

    // Merge queue logging actions
    logMergeQueueEntry: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitMergeQueueEntry({ context }),
        ),
    }),
    logMergeQueueFailure: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitMergeQueueFailure({ context }),
        ),
    }),
    logMerged: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitMerged({ context })),
    }),
    logDeployedStage: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitDeployedStage({ context }),
        ),
    }),
    logDeployedProd: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitDeployedProd({ context }),
        ),
    }),

    // Push to draft action
    pushToDraft: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitPushToDraft({ context })),
    }),

    // Reset action
    resetIssue: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitResetIssue({ context })),
    }),
    logResetting: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog(
            { context },
            `Resetting issue #${context.issue.number} to initial state`,
          ),
        ),
    }),

    // Grooming actions
    runClaudeGrooming: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudeGrooming({ context }),
        ),
    }),
    logGrooming: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, `Grooming issue #${context.issue.number}`),
        ),
    }),
    setReady: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitSetReady({ context })),
    }),

    // Pivot actions
    runClaudePivot: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudePivot({ context }),
        ),
    }),
    logPivoting: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLog({ context }, `Pivoting issue #${context.issue.number}`),
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
     *
     * Uses event-based transitions (DETECT) instead of `always` to ensure
     * only ONE state transition happens per invocation. This prevents the
     * iteration counter from advancing multiple times in a single run.
     */
    detecting: {
      entry: "logDetecting",
      on: {
        DETECT: [
          // Reset takes priority - can reset even Done/Blocked issues
          { target: "resetting", guard: "triggeredByReset" },
          // Pivot takes priority - can pivot even Done/Blocked issues
          { target: "pivoting", guard: "triggeredByPivot" },
          // Check terminal states first
          { target: "done", guard: "isAlreadyDone" },
          { target: "blocked", guard: "isBlocked" },
          { target: "error", guard: "isError" },
          // Merge queue logging events (handle early, they're log-only)
          {
            target: "mergeQueueLogging",
            guard: "triggeredByMergeQueueEntry",
          },
          {
            target: "mergeQueueFailureLogging",
            guard: "triggeredByMergeQueueFailure",
          },
          // PR merged -> process merge (close sub-issue, then orchestrate)
          { target: "processingMerge", guard: "triggeredByPRMerged" },
          { target: "deployedStageLogging", guard: "triggeredByDeployedStage" },
          { target: "deployedProdLogging", guard: "triggeredByDeployedProd" },
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
          // Check if this is a PR review approval (Claude approved via nopo-reviewer)
          {
            target: "processingReview",
            guard: "triggeredByPRReviewApproved",
          },
          // Check if this is a push to a PR branch
          {
            target: "prPush",
            guard: "triggeredByPRPush",
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
          // Check if this is a grooming trigger
          {
            target: "grooming",
            guard: "triggeredByGroom",
          },
          // Check if issue needs grooming (has triaged but not groomed)
          // This ensures triaged issues get groomed before any work begins
          {
            target: "grooming",
            guard: "needsGrooming",
          },
          // Check for multi-phase work
          { target: "initializing", guard: "needsSubIssues" },
          { target: "orchestrating", guard: "hasSubIssues" },
          // Check current state
          { target: "reviewing", guard: "isInReview" },
          // Check if ready for review (CI passed + todos done) from any trigger
          // This allows the state machine to "catch up" when re-triggered
          { target: "transitioningToReview", guard: "readyForReview" },
          // Only sub-issues can iterate directly - parent issues must have sub-issues
          { target: "iterating", guard: "isSubIssue" },
          // FATAL: Parent issue without sub-issues cannot iterate
          // This catches misconfigured issues that weren't properly groomed
          { target: "invalidIteration" },
        ],
      },
    },

    /**
     * Triage an issue - analyze, label, create sub-issues
     */
    triaging: {
      entry: ["logTriaging", "runClaudeTriage"],
      type: "final",
    },

    /**
     * Groom an issue - run PM, Engineer, QA, Research agents in parallel
     *
     * This runs 4 grooming agents to analyze the issue and determine if it's
     * ready for implementation. The applyGroomingOutput action then runs the
     * summary agent and applies the decision:
     * - ready: add "groomed" label, set status to Ready
     * - needs_info: add "needs-info" label, post questions
     * - blocked: set status to Blocked, post reason
     */
    grooming: {
      entry: ["logGrooming", "runClaudeGrooming"],
      type: "final",
    },

    /**
     * Pivot an issue - modify specifications mid-flight (/pivot command)
     *
     * This is a TERMINAL state - after pivot analysis and changes are applied,
     * the workflow STOPS. The user must review changes and manually restart
     * with /lfg to continue implementation.
     *
     * Safety constraints enforced by the executor:
     * - Cannot modify checked todos ([x] items are immutable)
     * - Cannot modify closed sub-issues
     * - For completed work changes, creates NEW sub-issues (reversion/extension)
     */
    pivoting: {
      entry: ["logPivoting", "runClaudePivot"],
      type: "final",
    },

    /**
     * Reset an issue to initial state (/reset command)
     * - Reopens closed issues
     * - Sets parent status to Backlog, sub-issues to Ready
     * - Clears iteration and failure counters
     * - Unassigns bot
     */
    resetting: {
      entry: ["logResetting", "resetIssue"],
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
     * PR Push - converts PR to draft and removes reviewer
     *
     * Triggered when code is pushed to a PR branch. This cancels in-flight
     * reviews and signals that iteration will continue.
     */
    prPush: {
      entry: ["pushToDraft", "setInProgress"],
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
          actions: ["historyCISuccess"],
        },
        // CI passed but todos not done -> continue iterating
        {
          target: "iterating",
          guard: "ciPassed",
          actions: ["clearFailures", "historyCISuccess"],
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
        // Approved -> mark ready for merge and wait for human to merge
        {
          target: "awaitingMerge",
          guard: "reviewApproved",
          actions: ["mergePR"],
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
     * Waiting for human to merge the PR
     * PR has "ready-to-merge" label, waiting for actual merge
     */
    awaitingMerge: {
      entry: ["logAwaitingMerge", "setReview"],
      type: "final",
    },

    /**
     * Processing a merged PR
     * Closes the sub-issue and advances to orchestrating
     */
    processingMerge: {
      entry: ["logMerged", "setDone", "closeIssue"],
      always: "orchestrating",
    },

    /**
     * Transitioning to review state
     */
    transitioningToReview: {
      entry: ["transitionToReview", "historyReviewRequested"],
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
        "historyIterationStarted",
        "logIterating",
        "runClaude",
        "createPR",
      ],
      on: {
        CI_SUCCESS: [
          {
            target: "transitioningToReview",
            guard: "todosDone",
            actions: ["historyCISuccess"],
          },
          {
            target: "iterating",
            actions: ["clearFailures", "historyCISuccess"],
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
        "historyIterationStarted",
        "logFixingCI",
        "runClaudeFixCI",
        "createPR",
      ],
      on: {
        CI_SUCCESS: [
          {
            target: "transitioningToReview",
            guard: "todosDone",
            actions: ["historyCISuccess"],
          },
          {
            target: "iterating",
            actions: ["clearFailures", "historyCISuccess"],
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
      entry: ["logReviewing", "setReview"],
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
     * Invalid iteration attempt - parent issue without sub-issues tried to iterate
     *
     * This is a FATAL error that indicates the issue was not properly groomed.
     * Only sub-issues (issues with a parent) can be iterated on directly.
     * Parent issues must go through orchestration which manages their sub-issues.
     *
     * To fix: Run grooming on this issue to create sub-issues, then trigger
     * orchestration on the parent.
     */
    invalidIteration: {
      entry: ["logInvalidIteration", "setError"],
      type: "final",
    },

    // =========================================================================
    // Merge Queue Logging States
    // =========================================================================
    // These states handle logging of merge queue, merge, and deployment events
    // They emit history entries to both sub-issue AND parent issue for visibility

    /**
     * Log merge queue entry event
     */
    mergeQueueLogging: {
      entry: ["logMergeQueueEntry"],
      type: "final",
    },

    /**
     * Log merge queue failure event
     */
    mergeQueueFailureLogging: {
      entry: ["logMergeQueueFailure"],
      type: "final",
    },

    /**
     * Log PR merged event
     */
    mergedLogging: {
      entry: ["logMerged"],
      type: "final",
    },

    /**
     * Log stage deployment event
     */
    deployedStageLogging: {
      entry: ["logDeployedStage"],
      type: "final",
    },

    /**
     * Log production deployment event
     */
    deployedProdLogging: {
      entry: ["logDeployedProd"],
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
    case "workflow-run-completed":
      if (context.ciResult === "success") {
        return { type: "CI_SUCCESS" };
      } else if (context.ciResult === "failure") {
        return { type: "CI_FAILURE" };
      }
      return { type: "START" };

    case "pr-review-submitted":
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
