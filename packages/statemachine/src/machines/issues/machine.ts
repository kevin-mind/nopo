/**
 * Issue automation state machine.
 *
 * Contains both the XState machine definition (issueInvokeMachine) and the
 * IssueMachine class that wraps it with logging and type aliases.
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
import type { AnyEventObject, AnyStateMachine, EventObject } from "xstate";
import type { MachineContext, Action } from "../../core/schemas.js";
import {
  BaseMachine,
  type BaseMachineResult,
  type BaseRunOptions,
  type BaseExecuteOptions,
  type BaseExecuteResult,
} from "../../core/machine.js";
import { guards } from "./guards.js";
import { STATES } from "./states.js";
import type { IssueState } from "./states.js";
import type { IssueMachineEvent } from "./events.js";
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
      entry: "runClaudeTriage",
      type: "final",
    },

    [STATES.grooming]: {
      entry: "runClaudeGrooming",
      type: "final",
    },

    [STATES.pivoting]: {
      entry: "runClaudePivot",
      type: "final",
    },

    [STATES.resetting]: {
      entry: "resetIssue",
      type: "final",
    },

    [STATES.retrying]: {
      entry: "retryIssue",
      always: [
        { target: STATES.orchestrationRunning, guard: "hasSubIssues" },
        { target: STATES.iterating },
      ],
    },

    [STATES.commenting]: {
      entry: "runClaudeComment",
      type: "final",
    },

    [STATES.prReviewing]: {
      entry: "runClaudePRReview",
      type: "final",
    },

    [STATES.prResponding]: {
      entry: "runClaudePRResponse",
      type: "final",
    },

    [STATES.prRespondingHuman]: {
      entry: "runClaudePRHumanResponse",
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
      entry: "setReview",
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
      entry: "setReview",
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

// ---------------------------------------------------------------------------
// IssueMachine — wraps the XState machine with logging and type aliases
// ---------------------------------------------------------------------------

/**
 * State-to-log-message map for diagnostic logging.
 * Messages are generated from the machine context when entering each state.
 */
const STATE_LOG_MESSAGES: Record<
  string,
  (ctx: MachineContext) => string | null
> = {
  detecting: () => "Detecting initial state",
  triaging: (ctx) => `Triaging issue #${ctx.issue.number}`,
  grooming: (ctx) => `Grooming issue #${ctx.issue.number}`,
  pivoting: (ctx) => `Pivoting issue #${ctx.issue.number}`,
  resetting: (ctx) => `Resetting issue #${ctx.issue.number} to initial state`,
  retrying: (ctx) => `Retrying issue #${ctx.issue.number} (clearing failures)`,
  commenting: (ctx) => `Responding to comment on #${ctx.issue.number}`,
  prReviewing: (ctx) => `Reviewing PR #${ctx.pr?.number ?? "unknown"}`,
  prResponding: (ctx) =>
    `Responding to review on PR #${ctx.pr?.number ?? "unknown"}`,
  prRespondingHuman: (ctx) =>
    `Responding to review on PR #${ctx.pr?.number ?? "unknown"}`,
  orchestrating: (ctx) =>
    `Orchestrating issue #${ctx.issue.number} (phase ${ctx.currentPhase}/${ctx.totalPhases})`,
  orchestrationWaiting: () => "Waiting for review on current phase",
  awaitingMerge: (ctx) =>
    `PR #${ctx.pr?.number} marked ready for merge - awaiting human action`,
  iterating: (ctx) => `Starting iteration ${ctx.issue.iteration + 1}`,
  iteratingFix: (ctx) => `Fixing CI (iteration ${ctx.issue.iteration + 1})`,
  reviewing: () => "PR is under review",
  subIssueIdle: (ctx) =>
    `Sub-issue #${ctx.issue.number} edited but not assigned — skipping`,
};

// Type aliases for backward compatibility
export type MachineResult = BaseMachineResult<IssueState>;

export interface RunOptions extends BaseRunOptions {
  event?: IssueMachineEvent;
}

export type ExecuteOptions = BaseExecuteOptions;
export type ExecuteResult = BaseExecuteResult<IssueState>;

/**
 * IssueMachine wraps the invoke-based XState machine.
 *
 * Usage (predict mode - default):
 *   const machine = new IssueMachine(context);
 *   const result = machine.run();
 *
 * Usage (execute mode - with real runner):
 *   const machine = new IssueMachine(context);
 *   const result = await machine.execute({ runnerContext });
 */
export class IssueMachine extends BaseMachine<IssueState> {
  protected getMachine(): AnyStateMachine {
    return issueInvokeMachine;
  }

  protected getDefaultEvent(): EventObject {
    return { type: "DETECT" };
  }

  protected override getLogMessage(stateName: string): string | null {
    const messageFn = STATE_LOG_MESSAGES[stateName];
    return messageFn ? messageFn(this.context) : null;
  }
}
