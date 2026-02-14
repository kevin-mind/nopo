/**
 * Invoke-based issue automation state machine.
 *
 * Uses XState's invoke + fromPromise for side effects.
 * Default stubs auto-succeed (predict mode).
 * Real implementations injected via .provide() (execute mode).
 * onDone + assign() accumulates actions into context.
 *
 * Key difference from emit approach: side effects are modeled as
 * invoked services, making the machine aware of async operations.
 * The machine waits for services to complete before transitioning.
 *
 * Note: For the synchronous predict/plan use case, all services
 * resolve immediately. For execute mode, .provide() can inject
 * services that perform real I/O.
 */

import { and, not, assign, setup } from "xstate";
import type { AnyEventObject } from "xstate";
import type { MachineContext, Action } from "../../core/schemas.js";
import { guards } from "../issues/guards.js";
import { STATES } from "../issues/states.js";
import type { IssueMachineEvent } from "../issues/events.js";
import { buildActionsForService } from "./services.js";

/**
 * Machine context with accumulated actions
 */
export interface InvokeMachineContext extends MachineContext {
  pendingActions: Action[];
}

/**
 * Helper: create an XState assign action that synchronously builds and
 * appends actions from a service name. This gives the invoke machine
 * the same synchronous behavior as the emit machine for plan/predict mode,
 * while the Machine class can swap in async services for execute mode.
 */
function syncAction(...serviceNames: string[]) {
  return assign<
    InvokeMachineContext,
    AnyEventObject,
    undefined,
    IssueMachineEvent,
    never
  >({
    pendingActions: ({ context }: { context: InvokeMachineContext }) => {
      const newActions: Action[] = [];
      for (const name of serviceNames) {
        newActions.push(...buildActionsForService(name, context));
      }
      return [...context.pendingActions, ...newActions];
    },
  });
}

/**
 * The invoke-based issue automation state machine.
 *
 * Uses synchronous assign actions that call buildActionsForService()
 * to produce the same output as the original machine. The Machine class
 * can override individual services via .provide() for execute mode.
 */
export const issueInvokeMachine = setup({
  types: {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions
    context: {} as InvokeMachineContext,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions
    events: {} as IssueMachineEvent,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions
    input: {} as MachineContext,
  },
  guards,
  actions: {
    // Log actions
    logDetecting: syncAction("logDetecting"),
    logIterating: syncAction("logIterating"),
    logFixingCI: syncAction("logFixingCI"),
    logReviewing: syncAction("logReviewing"),
    logTriaging: syncAction("logTriaging"),
    logCommenting: syncAction("logCommenting"),
    logWaitingForReview: syncAction("logWaitingForReview"),
    logAwaitingMerge: syncAction("logAwaitingMerge"),
    logOrchestrating: syncAction("logOrchestrating"),
    logPRReviewing: syncAction("logPRReviewing"),
    logPRResponding: syncAction("logPRResponding"),
    logResetting: syncAction("logResetting"),
    logRetrying: syncAction("logRetrying"),
    logGrooming: syncAction("logGrooming"),
    logPivoting: syncAction("logPivoting"),

    // History actions
    historyIterationStarted: syncAction("historyIterationStarted"),
    historyCISuccess: syncAction("historyCISuccess"),
    historyReviewRequested: syncAction("historyReviewRequested"),

    // Status actions
    setWorking: syncAction("setWorking"),
    setReview: syncAction("setReview"),
    setInProgress: syncAction("setInProgress"),
    setDone: syncAction("setDone"),
    setError: syncAction("setError"),

    // Iteration actions
    incrementIteration: syncAction("incrementIteration"),
    clearFailures: syncAction("clearFailures"),

    // Issue actions
    closeIssue: syncAction("closeIssue"),

    // Git actions
    createBranch: syncAction("createBranch"),

    // PR actions
    createPR: syncAction("createPR"),
    convertToDraft: syncAction("convertToDraft"),
    mergePR: syncAction("mergePR"),

    // Compound actions
    transitionToReview: syncAction("transitionToReview"),
    handleCIFailure: syncAction("handleCIFailure"),
    blockIssue: syncAction("blockIssue"),
    orchestrate: syncAction("orchestrate"),
    allPhasesDone: syncAction("allPhasesDone"),
    resetIssue: syncAction("resetIssue"),
    retryIssue: syncAction("retryIssue"),
    pushToDraft: syncAction("pushToDraft"),
    logInvalidIteration: syncAction("logInvalidIteration"),

    // Claude actions
    runClaude: syncAction("runClaude"),
    runClaudeFixCI: syncAction("runClaudeFixCI"),
    runClaudeTriage: syncAction("runClaudeTriage"),
    runClaudeComment: syncAction("runClaudeComment"),
    runClaudePRReview: syncAction("runClaudePRReview"),
    runClaudePRResponse: syncAction("runClaudePRResponse"),
    runClaudePRHumanResponse: syncAction("runClaudePRHumanResponse"),
    runClaudeGrooming: syncAction("runClaudeGrooming"),
    runClaudePivot: syncAction("runClaudePivot"),

    // Merge queue / deployment logging
    logMergeQueueEntry: syncAction("logMergeQueueEntry"),
    logMergeQueueFailure: syncAction("logMergeQueueFailure"),
    logMerged: syncAction("logMerged"),
    logDeployedStage: syncAction("logDeployedStage"),
    logDeployedProd: syncAction("logDeployedProd"),
    logDeployedStageFailure: syncAction("logDeployedStageFailure"),
    logDeployedProdFailure: syncAction("logDeployedProdFailure"),

    // Stop (needs event.reason)
    stopWithReason: assign<
      InvokeMachineContext,
      AnyEventObject,
      undefined,
      IssueMachineEvent,
      never
    >({
      pendingActions: ({ context, event }) => {
        const reason =
          "reason" in event && typeof event.reason === "string"
            ? event.reason
            : "unknown";
        return [
          ...context.pendingActions,
          ...buildActionsForService("stopWithReason", context, reason),
        ];
      },
    }),

    // subIssueIdle inline log
    logSubIssueIdle: syncAction("logSubIssueIdle"),
  },
}).createMachine({
  id: "issue-invoke",
  initial: STATES.detecting,
  context: ({ input }) => ({
    ...input,
    pendingActions: [],
  }),

  states: {
    [STATES.detecting]: {
      entry: "logDetecting",
      on: {
        DETECT: [
          { target: STATES.resetting, guard: "triggeredByReset" },
          { target: STATES.retrying, guard: "triggeredByRetry" },
          { target: STATES.pivoting, guard: "triggeredByPivot" },
          { target: STATES.orchestrationComplete, guard: "allPhasesDone" },
          { target: STATES.done, guard: "isAlreadyDone" },
          { target: STATES.alreadyBlocked, guard: "isBlocked" },
          { target: STATES.error, guard: "isError" },
          {
            target: STATES.mergeQueueLogging,
            guard: "triggeredByMergeQueueEntry",
          },
          {
            target: STATES.mergeQueueFailureLogging,
            guard: "triggeredByMergeQueueFailure",
          },
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
          { target: STATES.triaging, guard: "triggeredByTriage" },
          { target: STATES.commenting, guard: "triggeredByComment" },
          { target: STATES.orchestrating, guard: "triggeredByOrchestrate" },
          {
            target: STATES.prReviewing,
            guard: and(["triggeredByPRReview", "ciPassed"]),
          },
          {
            target: STATES.prReviewAssigned,
            guard: and(["triggeredByPRReview", not("ciFailed")]),
          },
          { target: STATES.prReviewSkipped, guard: "triggeredByPRReview" },
          { target: STATES.prResponding, guard: "triggeredByPRResponse" },
          {
            target: STATES.prRespondingHuman,
            guard: "triggeredByPRHumanResponse",
          },
          {
            target: STATES.processingReview,
            guard: "triggeredByPRReviewApproved",
          },
          { target: STATES.prPush, guard: "triggeredByPRPush" },
          { target: STATES.processingCI, guard: "triggeredByCI" },
          { target: STATES.processingReview, guard: "triggeredByReview" },
          { target: STATES.triaging, guard: "needsTriage" },
          { target: STATES.iterating, guard: "subIssueCanIterate" },
          { target: STATES.subIssueIdle, guard: "isSubIssue" },
          { target: STATES.grooming, guard: "triggeredByGroom" },
          { target: STATES.grooming, guard: "needsGrooming" },
          { target: STATES.initializing, guard: "needsSubIssues" },
          { target: STATES.orchestrating, guard: "hasSubIssues" },
          { target: STATES.reviewing, guard: "isInReview" },
          { target: STATES.transitioningToReview, guard: "readyForReview" },
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
      entry: ["logSubIssueIdle"],
      type: "final",
    },

    [STATES.invalidIteration]: {
      entry: ["logInvalidIteration", "setError"],
      type: "final",
    },

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
