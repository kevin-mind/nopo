import { assign, setup } from "xstate";
import type { MachineContext, Action } from "../schemas/index.js";
import { guards } from "./guards.js";
import { emit, accumulateFromEmitter } from "./emit-helper.js";
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
  emitDeployedStageFailure,
  emitDeployedProdFailure,
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
    subIssueCanIterate: ({ context }) => guards.subIssueCanIterate({ context }),
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
    triggeredByDeployedStageFailure: ({ context }) =>
      guards.triggeredByDeployedStageFailure({ context }),
    triggeredByDeployedProdFailure: ({ context }) =>
      guards.triggeredByDeployedProdFailure({ context }),
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
    logDetecting: emit<MachineEvent>((ctx) =>
      emitLog(ctx, "Detecting initial state"),
    ),
    logIterating: emit<MachineEvent>((ctx) =>
      emitLog(ctx, `Starting iteration ${ctx.context.issue.iteration + 1}`),
    ),
    logFixingCI: emit<MachineEvent>((ctx) =>
      emitLog(ctx, `Fixing CI (iteration ${ctx.context.issue.iteration + 1})`),
    ),
    logReviewing: emit<MachineEvent>((ctx) =>
      emitLog(ctx, "PR is under review"),
    ),
    logTriaging: emit<MachineEvent>((ctx) =>
      emitLog(ctx, `Triaging issue #${ctx.context.issue.number}`),
    ),
    logCommenting: emit<MachineEvent>((ctx) =>
      emitLog(ctx, `Responding to comment on #${ctx.context.issue.number}`),
    ),
    logWaitingForReview: emit<MachineEvent>((ctx) =>
      emitLog(ctx, "Waiting for review on current phase"),
    ),
    logAwaitingMerge: emit<MachineEvent>((ctx) =>
      emitLog(
        ctx,
        `PR #${ctx.context.pr?.number} marked ready for merge - awaiting human action`,
      ),
    ),

    // Iteration history logging (writes to issue body)
    historyIterationStarted: emit<MachineEvent>(emitLogIterationStarted),
    historyCISuccess: emit<MachineEvent>(emitLogCISuccess),
    historyReviewRequested: emit<MachineEvent>(emitLogReviewRequested),

    // Status actions
    setWorking: emit<MachineEvent>(emitSetWorking),
    setReview: emit<MachineEvent>(emitSetReview),
    setInProgress: emit<MachineEvent>(emitSetInProgress),
    setDone: emit<MachineEvent>(emitSetDone),
    setBlocked: emit<MachineEvent>(emitSetBlocked),
    setError: emit<MachineEvent>(emitSetError),
    logInvalidIteration: emit<MachineEvent>(emitLogInvalidIteration),

    // Iteration actions
    incrementIteration: emit<MachineEvent>(emitIncrementIteration),
    recordFailure: emit<MachineEvent>(emitRecordFailure),
    clearFailures: emit<MachineEvent>(emitClearFailures),

    // Issue actions
    closeIssue: emit<MachineEvent>(emitCloseIssue),
    unassign: emit<MachineEvent>(emitUnassign),

    // Git actions
    createBranch: emit<MachineEvent>(emitCreateBranch),

    // Claude actions
    runClaude: emit<MachineEvent>(emitRunClaude),
    runClaudeFixCI: emit<MachineEvent>(emitRunClaudeFixCI),
    runClaudeTriage: emit<MachineEvent>(emitRunClaudeTriage),
    runClaudeComment: emit<MachineEvent>(emitRunClaudeComment),

    // PR actions
    createPR: emit<MachineEvent>(emitCreatePR),
    markPRReady: emit<MachineEvent>(emitMarkReady),
    requestReview: emit<MachineEvent>(emitRequestReview),
    convertToDraft: emit<MachineEvent>(emitConvertToDraft),
    mergePR: emit<MachineEvent>(emitMergePR),
    runClaudePRReview: emit<MachineEvent>(emitRunClaudePRReview),
    runClaudePRResponse: emit<MachineEvent>(emitRunClaudePRResponse),
    runClaudePRHumanResponse: emit<MachineEvent>(emitRunClaudePRHumanResponse),
    logPRReviewing: emit<MachineEvent>((ctx) =>
      emitLog(ctx, `Reviewing PR #${ctx.context.pr?.number ?? "unknown"}`),
    ),
    logPRResponding: emit<MachineEvent>((ctx) =>
      emitLog(
        ctx,
        `Responding to review on PR #${ctx.context.pr?.number ?? "unknown"}`,
      ),
    ),

    // Compound actions
    transitionToReview: emit<MachineEvent>(emitTransitionToReview),
    handleCIFailure: emit<MachineEvent>(emitHandleCIFailure),
    blockIssue: emit<MachineEvent>(emitBlockIssue),

    // Orchestration actions
    orchestrate: emit<MachineEvent>(emitOrchestrate),
    allPhasesDone: emit<MachineEvent>(emitAllPhasesDone),
    logOrchestrating: emit<MachineEvent>((ctx) =>
      emitLog(
        ctx,
        `Orchestrating issue #${ctx.context.issue.number} (phase ${ctx.context.currentPhase}/${ctx.context.totalPhases})`,
      ),
    ),

    // Stop action (needs event.reason - inline assign)
    stopWithReason: assign({
      pendingActions: ({ context, event }) => {
        const reason =
          "reason" in event && typeof event.reason === "string"
            ? event.reason
            : "unknown";
        return accumulateFromEmitter(context.pendingActions, context, (ctx) =>
          emitStop(ctx, reason),
        );
      },
    }),

    // Merge queue logging actions
    logMergeQueueEntry: emit<MachineEvent>(emitMergeQueueEntry),
    logMergeQueueFailure: emit<MachineEvent>(emitMergeQueueFailure),
    logMerged: emit<MachineEvent>(emitMerged),
    logDeployedStage: emit<MachineEvent>(emitDeployedStage),
    logDeployedProd: emit<MachineEvent>(emitDeployedProd),
    logDeployedStageFailure: emit<MachineEvent>(emitDeployedStageFailure),
    logDeployedProdFailure: emit<MachineEvent>(emitDeployedProdFailure),

    // Push to draft action
    pushToDraft: emit<MachineEvent>(emitPushToDraft),

    // Reset action
    resetIssue: emit<MachineEvent>(emitResetIssue),
    logResetting: emit<MachineEvent>((ctx) =>
      emitLog(
        ctx,
        `Resetting issue #${ctx.context.issue.number} to initial state`,
      ),
    ),

    // Grooming actions
    runClaudeGrooming: emit<MachineEvent>(emitRunClaudeGrooming),
    logGrooming: emit<MachineEvent>((ctx) =>
      emitLog(ctx, `Grooming issue #${ctx.context.issue.number}`),
    ),
    setReady: emit<MachineEvent>(emitSetReady),

    // Pivot actions
    runClaudePivot: emit<MachineEvent>(emitRunClaudePivot),
    logPivoting: emit<MachineEvent>((ctx) =>
      emitLog(ctx, `Pivoting issue #${ctx.context.issue.number}`),
    ),
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
          {
            target: "deployedStageFailureLogging",
            guard: "triggeredByDeployedStageFailure",
          },
          {
            target: "deployedProdFailureLogging",
            guard: "triggeredByDeployedProdFailure",
          },
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
          // Sub-issues with bot assigned iterate - check BEFORE grooming and orchestration
          // to prevent sub-issues from being groomed or routed to orchestration
          { target: "iterating", guard: "subIssueCanIterate" },
          // Sub-issues without bot assignment: no-op (bot edits, reconciliation, etc.)
          { target: "subIssueIdle", guard: "isSubIssue" },
          // Check if this is a grooming trigger (parent issues only)
          {
            target: "grooming",
            guard: "triggeredByGroom",
          },
          // Check if issue needs grooming (has triaged but not groomed)
          // This ensures triaged parent issues get groomed before any work begins
          {
            target: "grooming",
            guard: "needsGrooming",
          },
          // Check for multi-phase work (parent issues only)
          { target: "initializing", guard: "needsSubIssues" },
          { target: "orchestrating", guard: "hasSubIssues" },
          // Check current state
          { target: "reviewing", guard: "isInReview" },
          // Check if ready for review (CI passed + todos done) from any trigger
          // This allows the state machine to "catch up" when re-triggered
          { target: "transitioningToReview", guard: "readyForReview" },
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
     * Sub-issue edited but not assigned to bot - skip silently
     *
     * This handles bot-initiated edits (reconciliation, triage body updates)
     * that fire issues:edited events on sub-issues. Without bot assignment,
     * these should not trigger iteration.
     */
    subIssueIdle: {
      entry: [
        emit<MachineEvent>((ctx) =>
          emitLog(
            ctx,
            `Sub-issue #${ctx.context.issue.number} edited but not assigned — skipping`,
          ),
        ),
      ],
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
     * Log stage deployment failure
     */
    deployedStageFailureLogging: {
      entry: ["logDeployedStageFailure"],
      type: "final",
    },

    /**
     * Log production deployment failure
     */
    deployedProdFailureLogging: {
      entry: ["logDeployedProdFailure"],
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
