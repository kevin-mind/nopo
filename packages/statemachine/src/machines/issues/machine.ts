/**
 * Issue automation state machine.
 *
 * Simple actions are inlined directly. Compound/complex actions are imported
 * from ./actions.ts and wrapped with emit().
 */

import { and, not, assign, setup } from "xstate";
import type { MachineContext } from "../../core/schemas.js";
import { actions } from "../../core/schemas.js";
import { deriveBranchName } from "../../core/parser.js";
import { HISTORY_ICONS, HISTORY_MESSAGES } from "../../core/constants.js";
import {
  createEmitter,
  accumulateFromEmitter,
} from "../../core/emit-helper.js";
import { emitLog } from "../../core/action-helpers.js";
import type { BaseMachineContext } from "../../core/types.js";
import { guards } from "./guards.js";
import { STATES } from "./states.js";
import type { IssueMachineEvent } from "./events.js";
import {
  // History & status helpers
  emitStatus,
  emitAppendHistory,
  emitUpdateHistory,
  // Compound actions
  transitionToReview,
  handleCIFailure,
  blockIssue,
  orchestrate,
  allPhasesDone,
  resetIssue,
  retryIssue,
  pushToDraft,
  logInvalidIteration,
  // Claude actions (complex prompt building)
  runClaude,
  runClaudeFixCI,
  runClaudeTriage,
  runClaudeComment,
  runClaudePRReview,
  runClaudePRResponse,
  runClaudePRHumanResponse,
  runClaudeGrooming,
  runClaudePivot,
  // Merge queue / deployment logging
  mergeQueueEntry,
  mergeQueueFailure,
  merged,
  deployedStage,
  deployedProd,
  deployedStageFailure,
  deployedProdFailure,
} from "./actions.js";

/**
 * Extended context that includes accumulated actions
 */
interface MachineContextWithActions
  extends MachineContext,
    BaseMachineContext {}

/** Typed emit bound to IssueMachineEvent — avoids repeating the generic at every call site. */
const e = createEmitter<IssueMachineEvent>();

/**
 * The issue automation state machine
 */
export const issueMachine = setup({
  types: {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions for machine type declarations
    context: {} as MachineContextWithActions,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions for machine type declarations
    events: {} as IssueMachineEvent,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions for machine type declarations
    input: {} as MachineContext,
  },
  guards,
  actions: {
    // =========================================================================
    // Simple inline actions
    // =========================================================================

    // Log actions
    logDetecting: e((ctx) => emitLog(ctx, "Detecting initial state")),
    logIterating: e((ctx) =>
      emitLog(ctx, `Starting iteration ${ctx.context.issue.iteration + 1}`),
    ),
    logFixingCI: e((ctx) =>
      emitLog(ctx, `Fixing CI (iteration ${ctx.context.issue.iteration + 1})`),
    ),
    logReviewing: e((ctx) => emitLog(ctx, "PR is under review")),
    logTriaging: e((ctx) =>
      emitLog(ctx, `Triaging issue #${ctx.context.issue.number}`),
    ),
    logCommenting: e((ctx) =>
      emitLog(ctx, `Responding to comment on #${ctx.context.issue.number}`),
    ),
    logWaitingForReview: e((ctx) =>
      emitLog(ctx, "Waiting for review on current phase"),
    ),
    logAwaitingMerge: e((ctx) =>
      emitLog(
        ctx,
        `PR #${ctx.context.pr?.number} marked ready for merge - awaiting human action`,
      ),
    ),
    logOrchestrating: e((ctx) =>
      emitLog(
        ctx,
        `Orchestrating issue #${ctx.context.issue.number} (phase ${ctx.context.currentPhase}/${ctx.context.totalPhases})`,
      ),
    ),
    logPRReviewing: e((ctx) =>
      emitLog(ctx, `Reviewing PR #${ctx.context.pr?.number ?? "unknown"}`),
    ),
    logPRResponding: e((ctx) =>
      emitLog(
        ctx,
        `Responding to review on PR #${ctx.context.pr?.number ?? "unknown"}`,
      ),
    ),
    logResetting: e((ctx) =>
      emitLog(
        ctx,
        `Resetting issue #${ctx.context.issue.number} to initial state`,
      ),
    ),
    logRetrying: e((ctx) =>
      emitLog(
        ctx,
        `Retrying issue #${ctx.context.issue.number} (clearing failures)`,
      ),
    ),
    logGrooming: e((ctx) =>
      emitLog(ctx, `Grooming issue #${ctx.context.issue.number}`),
    ),
    logPivoting: e((ctx) =>
      emitLog(ctx, `Pivoting issue #${ctx.context.issue.number}`),
    ),

    // Iteration history logging (writes to issue body)
    historyIterationStarted: e((ctx) =>
      emitAppendHistory(ctx, HISTORY_MESSAGES.ITERATING),
    ),
    historyCISuccess: e((ctx) =>
      emitUpdateHistory(
        ctx,
        HISTORY_ICONS.ITERATING,
        HISTORY_MESSAGES.CI_PASSED,
      ),
    ),
    historyReviewRequested: e((ctx) =>
      emitAppendHistory(ctx, HISTORY_MESSAGES.REVIEW_REQUESTED),
    ),

    // Status actions
    setWorking: e((ctx) => emitStatus(ctx, "In progress")),
    setReview: e((ctx) => emitStatus(ctx, "In review")),
    setInProgress: e(({ context }) => [
      actions.updateProjectStatus.create({
        issueNumber: context.issue.number,
        status: "In progress",
      }),
    ]),
    setDone: e(({ context }) => [
      actions.updateProjectStatus.create({
        issueNumber: context.issue.number,
        status: "Done",
      }),
    ]),
    setError: e(({ context }) => [
      actions.updateProjectStatus.create({
        issueNumber: context.issue.number,
        status: "Error",
      }),
    ]),

    // Iteration actions
    incrementIteration: e(({ context }) => [
      actions.incrementIteration.create({
        issueNumber: context.issue.number,
      }),
    ]),
    clearFailures: e(({ context }) => [
      actions.clearFailures.create({
        issueNumber: context.issue.number,
      }),
    ]),

    // Issue actions
    closeIssue: e(({ context }) => [
      actions.closeIssue.create({
        issueNumber: context.issue.number,
        reason: "completed" as const,
      }),
    ]),

    // Git actions
    createBranch: e(({ context }) => [
      actions.createBranch.create({
        branchName:
          context.branch ??
          deriveBranchName(
            context.issue.number,
            context.currentPhase ?? undefined,
          ),
        baseBranch: "main",
        worktree: "main",
      }),
    ]),

    // PR actions
    createPR: e(({ context }) => {
      if (context.pr) return [];
      const branchName =
        context.branch ??
        deriveBranchName(
          context.issue.number,
          context.currentPhase ?? undefined,
        );
      const issueNumber =
        context.currentSubIssue?.number ?? context.issue.number;
      return [
        actions.createPR.create({
          title: context.currentSubIssue?.title ?? context.issue.title,
          body: `Fixes #${issueNumber}`,
          branchName,
          baseBranch: "main",
          draft: true,
          issueNumber,
        }),
      ];
    }),
    convertToDraft: e(({ context }) => {
      if (!context.pr) return [];
      return [actions.convertPRToDraft.create({ prNumber: context.pr.number })];
    }),
    mergePR: e(({ context }) => {
      if (!context.pr) return [];
      const issueNumber =
        context.currentSubIssue?.number ?? context.issue.number;
      return [
        actions.mergePR.create({
          prNumber: context.pr.number,
          issueNumber,
          mergeMethod: "squash",
        }),
      ];
    }),

    // =========================================================================
    // Compound/complex actions (from ./actions.ts)
    // =========================================================================

    transitionToReview: e(transitionToReview),
    handleCIFailure: e(handleCIFailure),
    blockIssue: e(blockIssue),
    orchestrate: e(orchestrate),
    allPhasesDone: e(allPhasesDone),
    resetIssue: e(resetIssue),
    retryIssue: e(retryIssue),
    pushToDraft: e(pushToDraft),
    logInvalidIteration: e(logInvalidIteration),

    // Claude actions
    runClaude: e(runClaude),
    runClaudeFixCI: e(runClaudeFixCI),
    runClaudeTriage: e(runClaudeTriage),
    runClaudeComment: e(runClaudeComment),
    runClaudePRReview: e(runClaudePRReview),
    runClaudePRResponse: e(runClaudePRResponse),
    runClaudePRHumanResponse: e(runClaudePRHumanResponse),
    runClaudeGrooming: e(runClaudeGrooming),
    runClaudePivot: e(runClaudePivot),

    // Merge queue logging actions
    logMergeQueueEntry: e(mergeQueueEntry),
    logMergeQueueFailure: e(mergeQueueFailure),
    logMerged: e(merged),
    logDeployedStage: e(deployedStage),
    logDeployedProd: e(deployedProd),
    logDeployedStageFailure: e(deployedStageFailure),
    logDeployedProdFailure: e(deployedProdFailure),

    // Stop action (needs event.reason for the message - inline assign)
    stopWithReason: assign({
      pendingActions: ({ context, event }) => {
        const reason =
          "reason" in event && typeof event.reason === "string"
            ? event.reason
            : "unknown";
        return accumulateFromEmitter(context.pendingActions, context, () => [
          actions.stop.create({ message: reason }),
        ]);
      },
    }),
  },
}).createMachine({
  id: "issue-automation",
  initial: STATES.detecting,
  context: ({ input }) => ({
    ...input,
    pendingActions: [],
  }),

  states: {
    /**
     * Initial state - determine what to do based on context
     */
    [STATES.detecting]: {
      entry: "logDetecting",
      on: {
        DETECT: [
          // Reset takes priority - can reset even Done/Blocked issues
          { target: STATES.resetting, guard: "triggeredByReset" },
          // Retry takes priority - can retry even Blocked issues (circuit breaker recovery)
          { target: STATES.retrying, guard: "triggeredByRetry" },
          // Pivot takes priority - can pivot even Done/Blocked issues
          { target: STATES.pivoting, guard: "triggeredByPivot" },
          // All phases complete takes priority
          { target: STATES.orchestrationComplete, guard: "allPhasesDone" },
          // Check terminal states
          { target: STATES.done, guard: "isAlreadyDone" },
          { target: STATES.alreadyBlocked, guard: "isBlocked" },
          { target: STATES.error, guard: "isError" },
          // Merge queue logging events (handle early, they're log-only)
          {
            target: STATES.mergeQueueLogging,
            guard: "triggeredByMergeQueueEntry",
          },
          {
            target: STATES.mergeQueueFailureLogging,
            guard: "triggeredByMergeQueueFailure",
          },
          // PR merged -> process merge (close sub-issue, then orchestrate)
          { target: STATES.processingMerge, guard: "triggeredByPRMerged" },
          {
            target: STATES.deployedStageLogging,
            guard: "triggeredByDeployedStage",
          },
          {
            target: STATES.deployedProdLogging,
            guard: "triggeredByDeployedProd",
          },
          {
            target: STATES.deployedStageFailureLogging,
            guard: "triggeredByDeployedStageFailure",
          },
          {
            target: STATES.deployedProdFailureLogging,
            guard: "triggeredByDeployedProdFailure",
          },
          // Check if this is a triage request
          { target: STATES.triaging, guard: "triggeredByTriage" },
          // Check if this is a comment (@claude mention)
          { target: STATES.commenting, guard: "triggeredByComment" },
          // Check if this is an orchestration request
          { target: STATES.orchestrating, guard: "triggeredByOrchestrate" },
          // Check if this is a PR review request (bot should review)
          {
            target: STATES.prReviewing,
            guard: and(["triggeredByPRReview", "ciPassed"]),
          },
          // Ack review request when CI status is unknown
          {
            target: STATES.prReviewAssigned,
            guard: and(["triggeredByPRReview", not("ciFailed")]),
          },
          // Skip review when CI explicitly failed
          { target: STATES.prReviewSkipped, guard: "triggeredByPRReview" },
          // Check if this is a PR response (bot responds to bot's review)
          { target: STATES.prResponding, guard: "triggeredByPRResponse" },
          // Check if this is a PR human response
          {
            target: STATES.prRespondingHuman,
            guard: "triggeredByPRHumanResponse",
          },
          // Check if this is a PR review approval
          {
            target: STATES.processingReview,
            guard: "triggeredByPRReviewApproved",
          },
          // Check if this is a push to a PR branch
          { target: STATES.prPush, guard: "triggeredByPRPush" },
          // Check if this is a CI completion event
          { target: STATES.processingCI, guard: "triggeredByCI" },
          // Check if this is a review submission event (for orchestration)
          { target: STATES.processingReview, guard: "triggeredByReview" },
          // Check if issue needs triage
          { target: STATES.triaging, guard: "needsTriage" },
          // Sub-issues with bot assigned iterate
          { target: STATES.iterating, guard: "subIssueCanIterate" },
          // Sub-issues without bot assignment: no-op
          { target: STATES.subIssueIdle, guard: "isSubIssue" },
          // Check if this is a grooming trigger
          { target: STATES.grooming, guard: "triggeredByGroom" },
          // Check if issue needs grooming
          { target: STATES.grooming, guard: "needsGrooming" },
          // Check for multi-phase work
          { target: STATES.initializing, guard: "needsSubIssues" },
          { target: STATES.orchestrating, guard: "hasSubIssues" },
          // Check current state
          { target: STATES.reviewing, guard: "isInReview" },
          // Check if ready for review
          { target: STATES.transitioningToReview, guard: "readyForReview" },
          // FATAL: Parent issue without sub-issues cannot iterate
          { target: STATES.invalidIteration },
        ],
      },
    },

    [STATES.triaging]: {
      entry: ["logTriaging", "runClaudeTriage"],
      type: "final",
    },

    [STATES.grooming]: {
      entry: ["logGrooming", "runClaudeGrooming"],
      type: "final",
    },

    [STATES.pivoting]: {
      entry: ["logPivoting", "runClaudePivot"],
      type: "final",
    },

    [STATES.resetting]: {
      entry: ["logResetting", "resetIssue"],
      type: "final",
    },

    [STATES.retrying]: {
      entry: ["logRetrying", "retryIssue"],
      always: [
        { target: STATES.orchestrationRunning, guard: "hasSubIssues" },
        { target: STATES.iterating },
      ],
    },

    [STATES.commenting]: {
      entry: ["logCommenting", "runClaudeComment"],
      type: "final",
    },

    [STATES.prReviewing]: {
      entry: ["logPRReviewing", "runClaudePRReview"],
      type: "final",
    },

    [STATES.prResponding]: {
      entry: ["logPRResponding", "runClaudePRResponse"],
      type: "final",
    },

    [STATES.prRespondingHuman]: {
      entry: ["logPRResponding", "runClaudePRHumanResponse"],
      type: "final",
    },

    [STATES.prReviewSkipped]: {
      type: "final",
    },

    [STATES.prReviewAssigned]: {
      type: "final",
    },

    [STATES.prPush]: {
      entry: ["pushToDraft", "setInProgress"],
      type: "final",
    },

    [STATES.initializing]: {
      entry: ["setInProgress"],
      always: STATES.orchestrating,
    },

    [STATES.orchestrating]: {
      entry: ["logOrchestrating"],
      always: [
        { target: STATES.orchestrationComplete, guard: "allPhasesDone" },
        { target: STATES.orchestrationWaiting, guard: "currentPhaseInReview" },
        { target: STATES.orchestrationRunning },
      ],
    },

    [STATES.orchestrationRunning]: {
      entry: ["orchestrate"],
      type: "final",
    },

    [STATES.orchestrationWaiting]: {
      entry: ["logWaitingForReview"],
      type: "final",
    },

    [STATES.orchestrationComplete]: {
      entry: ["allPhasesDone"],
      type: "final",
    },

    [STATES.processingCI]: {
      always: [
        {
          target: STATES.transitioningToReview,
          guard: "readyForReview",
          actions: ["historyCISuccess"],
        },
        {
          target: STATES.iterating,
          guard: "ciPassed",
          actions: ["clearFailures", "historyCISuccess"],
        },
        {
          target: STATES.blocked,
          guard: "shouldBlock",
          actions: ["blockIssue"],
        },
        {
          target: STATES.iteratingFix,
          guard: "ciFailed",
          actions: ["handleCIFailure"],
        },
        { target: STATES.iterating },
      ],
    },

    [STATES.processingReview]: {
      always: [
        {
          target: STATES.awaitingMerge,
          guard: "reviewApproved",
          actions: ["mergePR"],
        },
        {
          target: STATES.iterating,
          guard: "reviewRequestedChanges",
          actions: ["convertToDraft"],
        },
        { target: STATES.reviewing },
      ],
    },

    [STATES.awaitingMerge]: {
      entry: ["logAwaitingMerge", "setReview"],
      type: "final",
    },

    [STATES.processingMerge]: {
      entry: ["logMerged", "setDone", "closeIssue"],
      always: STATES.orchestrating,
    },

    [STATES.transitioningToReview]: {
      entry: ["transitionToReview", "historyReviewRequested"],
      always: STATES.reviewing,
    },

    [STATES.iterating]: {
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
            target: STATES.transitioningToReview,
            guard: "todosDone",
            actions: ["historyCISuccess"],
          },
          {
            target: STATES.iterating,
            actions: ["clearFailures", "historyCISuccess"],
          },
        ],
        CI_FAILURE: [
          {
            target: STATES.blocked,
            guard: "maxFailuresReached",
            actions: ["blockIssue"],
          },
          {
            target: STATES.iteratingFix,
            actions: ["handleCIFailure"],
          },
        ],
      },
      type: "final",
    },

    [STATES.iteratingFix]: {
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
            target: STATES.transitioningToReview,
            guard: "todosDone",
            actions: ["historyCISuccess"],
          },
          {
            target: STATES.iterating,
            actions: ["clearFailures", "historyCISuccess"],
          },
        ],
        CI_FAILURE: [
          {
            target: STATES.blocked,
            guard: "maxFailuresReached",
            actions: ["blockIssue"],
          },
          {
            target: STATES.iteratingFix,
            actions: ["handleCIFailure"],
          },
        ],
      },
      type: "final",
    },

    [STATES.reviewing]: {
      entry: ["logReviewing", "setReview"],
      on: {
        REVIEW_APPROVED: STATES.orchestrating,
        REVIEW_CHANGES_REQUESTED: {
          target: STATES.iterating,
          actions: ["convertToDraft"],
        },
        REVIEW_COMMENTED: STATES.reviewing,
      },
      type: "final",
    },

    [STATES.blocked]: {
      type: "final",
    },

    [STATES.alreadyBlocked]: {
      type: "final",
    },

    [STATES.error]: {
      type: "final",
    },

    [STATES.subIssueIdle]: {
      entry: [
        e((ctx) =>
          emitLog(
            ctx,
            `Sub-issue #${ctx.context.issue.number} edited but not assigned — skipping`,
          ),
        ),
      ],
      type: "final",
    },

    [STATES.invalidIteration]: {
      entry: ["logInvalidIteration", "setError"],
      type: "final",
    },

    // Merge Queue Logging States
    [STATES.mergeQueueLogging]: {
      entry: ["logMergeQueueEntry"],
      type: "final",
    },

    [STATES.mergeQueueFailureLogging]: {
      entry: ["logMergeQueueFailure"],
      type: "final",
    },

    [STATES.mergedLogging]: {
      entry: ["logMerged"],
      type: "final",
    },

    [STATES.deployedStageLogging]: {
      entry: ["logDeployedStage"],
      type: "final",
    },

    [STATES.deployedProdLogging]: {
      entry: ["logDeployedProd"],
      type: "final",
    },

    [STATES.deployedStageFailureLogging]: {
      entry: ["logDeployedStageFailure"],
      type: "final",
    },

    [STATES.deployedProdFailureLogging]: {
      entry: ["logDeployedProdFailure"],
      type: "final",
    },

    [STATES.done]: {
      entry: ["setDone", "closeIssue"],
      type: "final",
    },
  },
});
