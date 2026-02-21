/**
 * Example PEV machine — built with createMachineFactory.
 *
 * Configures actions, guards, states, and refreshContext on the factory,
 * then builds the machine directly.
 * Imports only from core and local example files.
 */

import { assign } from "xstate";
import { createMachineFactory } from "../../core/pev/domain-machine-factory.js";
import type { ExampleContext } from "./context.js";
import {
  updateStatusAction,
  removeLabelsAction,
  runClaudeTriageAction,
  applyTriageOutputAction,
  runClaudeGroomingAction,
  applyGroomingOutputAction,
  reconcileSubIssuesAction,
  runClaudeIterationAction,
  applyIterationOutputAction,
  runClaudeReviewAction,
  applyReviewOutputAction,
  runClaudePrResponseAction,
  applyPrResponseOutputAction,
  runOrchestrationAction,
  recordFailureAction,
  setupGitAction,
  prepareBranchAction,
  gitPushAction,
  markPRReadyAction,
  requestReviewerAction,
  stopAction,
  type ExampleAction,
} from "./actions.js";
import {
  isStatusMisaligned,
  needsTriage,
  canIterate,
  isInReview,
  isInReviewFirstCycle,
  isAlreadyDone,
  isBlocked,
  isError,
  botIsAssigned,
  triggeredByAssignment,
  triggeredByEdit,
  triggeredByCI,
  triggeredByReview,
  triggeredByReviewRequest,
  triggeredByTriage,
  triggeredByComment,
  triggeredByOrchestrate,
  triggeredByOrchestrateAndReady,
  triggeredByOrchestrateAndNeedsGrooming,
  triggeredByPRReview,
  triggeredByPRResponse,
  triggeredByPRHumanResponse,
  triggeredByPRReviewApproved,
  triggeredByPRPush,
  triggeredByReset,
  triggeredByRetry,
  triggeredByPivot,
  triggeredByMergeQueueEntry,
  triggeredByMergeQueueFailure,
  triggeredByPRMerged,
  triggeredByDeployedStage,
  triggeredByDeployedProd,
  triggeredByDeployedStageFailure,
  triggeredByDeployedProdFailure,
  triggeredByGroom,
  triggeredByGroomSummary,
  ciPassed,
  ciFailed,
  reviewApproved,
  reviewRequestedChanges,
  reviewCommented,
  needsGrooming,
  needsSubIssues,
  hasSubIssues,
  currentPhaseInReview,
  currentPhaseBlocked,
  alreadyOrchestrated,
  allPhasesDone,
  maxFailuresReached,
  isSubIssue,
  shouldIterateSubIssue,
  isInvalidIteration,
  todosDone,
  readyForReview,
  triggeredByCIAndReadyForReview,
  triggeredByCIAndShouldContinue,
  triggeredByCIAndShouldBlock,
  triggeredByReviewAndApproved,
  triggeredByReviewAndChanges,
  triggeredByReviewAndCommented,
  prReviewWithCIPassed,
  prReviewWithCINotFailed,
  branchPrepCleanAndReadyForReview,
  branchPrepClean,
  branchPrepRebased,
  branchPrepConflicts,
} from "./guards.js";
import { createExampleQueueAssigners } from "./states.js";
import { ExampleContextLoader } from "./context.js";
import { persistIssueState, repositoryFor } from "./commands.js";
import type { ExampleMachineEvent } from "./events.js";
import type { ExampleServices } from "./services.js";
import { RUNNER_STATES } from "../../core/pev/runner-states.js";

export const exampleMachine = createMachineFactory<
  ExampleContext,
  ExampleAction,
  ExampleMachineEvent
>()
  .services<ExampleServices>()
  .actions((createAction) => ({
    updateStatus: updateStatusAction(createAction),
    removeLabels: removeLabelsAction(createAction),
    runClaudeTriage: runClaudeTriageAction(createAction),
    applyTriageOutput: applyTriageOutputAction(createAction),
    runClaudeGrooming: runClaudeGroomingAction(createAction),
    applyGroomingOutput: applyGroomingOutputAction(createAction),
    reconcileSubIssues: reconcileSubIssuesAction(createAction),
    runClaudeIteration: runClaudeIterationAction(createAction),
    applyIterationOutput: applyIterationOutputAction(createAction),
    runClaudeReview: runClaudeReviewAction(createAction),
    applyReviewOutput: applyReviewOutputAction(createAction),
    runClaudePrResponse: runClaudePrResponseAction(createAction),
    applyPrResponseOutput: applyPrResponseOutputAction(createAction),
    runOrchestration: runOrchestrationAction(createAction),
    recordFailure: recordFailureAction(createAction),
    setupGit: setupGitAction(createAction),
    prepareBranch: prepareBranchAction(createAction),
    gitPush: gitPushAction(createAction),
    markPRReady: markPRReadyAction(createAction),
    requestReviewer: requestReviewerAction(createAction),
    stop: stopAction(createAction),
  }))
  .guards(() => ({
    isStatusMisaligned,
    needsTriage,
    canIterate,
    isInReview,
    isInReviewFirstCycle,
    isAlreadyDone,
    isBlocked,
    isError,
    botIsAssigned,
    triggeredByAssignment,
    triggeredByEdit,
    triggeredByCI,
    triggeredByReview,
    triggeredByReviewRequest,
    triggeredByTriage,
    triggeredByComment,
    triggeredByOrchestrate,
    triggeredByOrchestrateAndReady,
    triggeredByOrchestrateAndNeedsGrooming,
    triggeredByPRReview,
    triggeredByPRResponse,
    triggeredByPRHumanResponse,
    triggeredByPRReviewApproved,
    triggeredByPRPush,
    triggeredByReset,
    triggeredByRetry,
    triggeredByPivot,
    triggeredByMergeQueueEntry,
    triggeredByMergeQueueFailure,
    triggeredByPRMerged,
    triggeredByDeployedStage,
    triggeredByDeployedProd,
    triggeredByDeployedStageFailure,
    triggeredByDeployedProdFailure,
    triggeredByGroom,
    triggeredByGroomSummary,
    ciPassed,
    ciFailed,
    reviewApproved,
    reviewRequestedChanges,
    reviewCommented,
    needsGrooming,
    needsSubIssues,
    hasSubIssues,
    currentPhaseInReview,
    currentPhaseBlocked,
    alreadyOrchestrated,
    allPhasesDone,
    maxFailuresReached,
    isSubIssue,
    shouldIterateSubIssue,
    isInvalidIteration,
    todosDone,
    readyForReview,
    triggeredByCIAndReadyForReview,
    triggeredByCIAndShouldContinue,
    triggeredByCIAndShouldBlock,
    triggeredByReviewAndApproved,
    triggeredByReviewAndChanges,
    triggeredByReviewAndCommented,
    prReviewWithCIPassed,
    prReviewWithCINotFailed,
    branchPrepCleanAndReadyForReview,
    branchPrepClean,
    branchPrepRebased,
    branchPrepConflicts,
  }))
  .states(({ registry }) => {
    const queue = createExampleQueueAssigners(registry);
    return {
      routing: {
        always: [
          // ARC 1-4: Explicit trigger actions take priority
          { target: "resetting", guard: "triggeredByReset" },
          { target: "retrying", guard: "triggeredByRetry" },
          { target: "pivoting", guard: "triggeredByPivot" },
          { target: "orchestrationComplete", guard: "allPhasesDone" },
          // ARC 5-7: Terminal states (intentionally set by machine actions)
          { target: RUNNER_STATES.done, guard: "isAlreadyDone" },
          { target: "alreadyBlocked", guard: "isBlocked" },
          { target: "error", guard: "isError" },
          // Parent iterating on current sub-issue after orchestration
          { target: "preparing", guard: "shouldIterateSubIssue" },
          // Branch prep results (checked before alreadyOrchestrated so
          // the prepare→iterate flow completes before stopping)
          {
            target: "completingReviewTransition",
            guard: "branchPrepCleanAndReadyForReview",
          },
          { target: "iterating", guard: "branchPrepClean" },
          { target: "branchRebased", guard: "branchPrepRebased" },
          { target: "blocking", guard: "branchPrepConflicts" },
          // Parent with sub-issues already orchestrated this invocation — stop
          { target: "idle", guard: "alreadyOrchestrated" },
          // ARC 8-14: Trigger-specific routing
          {
            target: "mergeQueueLogging",
            guard: "triggeredByMergeQueueEntry",
          },
          {
            target: "mergeQueueFailureLogging",
            guard: "triggeredByMergeQueueFailure",
          },
          { target: "processingMerge", guard: "triggeredByPRMerged" },
          {
            target: "processingDeployedStage",
            guard: "triggeredByDeployedStage",
          },
          {
            target: "processingDeployedProd",
            guard: "triggeredByDeployedProd",
          },
          {
            target: "processingDeployedStageFailure",
            guard: "triggeredByDeployedStageFailure",
          },
          {
            target: "processingDeployedProdFailure",
            guard: "triggeredByDeployedProdFailure",
          },
          // ARC 15-17
          { target: "triaging", guard: "triggeredByTriage" },
          { target: "commenting", guard: "triggeredByComment" },
          {
            target: "grooming",
            guard: "triggeredByOrchestrateAndNeedsGrooming",
          },
          {
            target: "orchestrating",
            guard: "triggeredByOrchestrateAndReady",
          },
          { target: "orchestrationWaiting", guard: "currentPhaseInReview" },
          { target: "blocking", guard: "currentPhaseBlocked" },
          // ARC 18-22
          {
            target: "prReviewing",
            guard: "prReviewWithCIPassed",
          },
          {
            target: "prReviewAssigned",
            guard: "prReviewWithCINotFailed",
          },
          { target: "prReviewSkipped", guard: "triggeredByPRReview" },
          { target: "prResponding", guard: "triggeredByPRResponse" },
          {
            target: "prRespondingHuman",
            guard: "triggeredByPRHumanResponse",
          },
          // ARC 23-24
          { target: "awaitingMerge", guard: "triggeredByPRReviewApproved" },
          { target: "prPush", guard: "triggeredByPRPush" },
          // ARC 25-28 (CI direct; 27 before 26 so max-failures blocks first)
          {
            target: "transitioningToReview",
            guard: "triggeredByCIAndReadyForReview",
          },
          { target: "blocking", guard: "triggeredByCIAndShouldBlock" },
          { target: "iteratingFix", guard: "triggeredByCIAndShouldContinue" },
          { target: "processingCI", guard: "triggeredByCI" },
          // ARC 29-32 (review direct)
          { target: "awaitingMerge", guard: "triggeredByReviewAndApproved" },
          { target: "iteratingFix", guard: "triggeredByReviewAndChanges" },
          { target: "reviewing", guard: "triggeredByReviewAndCommented" },
          { target: "reviewing", guard: "triggeredByReview" },
          // ARC 33-35
          { target: "triaging", guard: "needsTriage" },
          // "In review" — first cycle requests reviewer, subsequent cycles stop
          { target: "ensureReviewRequested", guard: "isInReviewFirstCycle" },
          { target: "awaitingReview", guard: "isInReview" },
          { target: "preparing", guard: "canIterate" },
          // Sub-issue status-based routing (before isSubIssue catch-all)
          { target: "transitioningToReview", guard: "readyForReview" },
          // Parent iterating on current sub-issue (after orchestration resets stale state)
          { target: "preparing", guard: "shouldIterateSubIssue" },
          { target: "subIssueIdle", guard: "isSubIssue" },
          // ARC 36-38
          { target: "grooming", guard: "triggeredByGroom" },
          { target: "grooming", guard: "triggeredByGroomSummary" },
          { target: "grooming", guard: "needsGrooming" },
          { target: "initializing", guard: "needsSubIssues" },
          { target: "orchestrating", guard: "hasSubIssues" },
          // Status misalignment — fix after all trigger/status routing
          // so trigger-specific actions take priority
          { target: "fixState", guard: "isStatusMisaligned" },
          // ARC 41-43
          { target: "invalidIteration", guard: "isInvalidIteration" },
          { target: "idle" },
        ],
      },
      fixState: {
        entry: queue.assignFixStateQueue,
        always: RUNNER_STATES.executingQueue,
      },
      triaging: {
        entry: queue.assignTriageQueue,
        always: RUNNER_STATES.executingQueue,
      },
      preparing: {
        entry: queue.assignPrepareQueue,
        always: RUNNER_STATES.executingQueue,
      },
      iterating: {
        entry: [
          assign({
            domain: ({ context }) => ({
              ...context.domain,
              branchPrepResult: null,
            }),
          }),
          queue.assignIterateQueue,
        ],
        always: RUNNER_STATES.executingQueue,
      },
      iteratingFix: {
        entry: [
          assign({
            domain: ({ context }) => ({
              ...context.domain,
              branchPrepResult: null,
            }),
          }),
          queue.assignIterateFixQueue,
        ],
        always: RUNNER_STATES.executingQueue,
      },
      transitioningToReview: {
        entry: queue.assignTransitionToReviewQueue,
        always: RUNNER_STATES.executingQueue,
      },
      completingReviewTransition: {
        entry: [
          assign({
            domain: ({ context }) => ({
              ...context.domain,
              branchPrepResult: null,
            }),
          }),
          queue.assignCompletingReviewTransitionQueue,
        ],
        always: RUNNER_STATES.executingQueue,
      },
      reviewing: {
        entry: queue.assignReviewQueue,
        always: RUNNER_STATES.executingQueue,
      },
      ensureReviewRequested: {
        entry: queue.assignAwaitingReviewQueue,
        always: RUNNER_STATES.executingQueue,
      },
      awaitingReview: { type: "final" },
      grooming: {
        entry: queue.assignGroomQueue,
        always: RUNNER_STATES.executingQueue,
      },
      initializing: {
        entry: queue.assignInitializingQueue,
        always: RUNNER_STATES.executingQueue,
      },
      pivoting: {
        entry: queue.assignPivotQueue,
        always: RUNNER_STATES.executingQueue,
      },
      resetting: {
        entry: queue.assignResetQueue,
        always: RUNNER_STATES.executingQueue,
      },
      retrying: {
        entry: queue.assignRetryQueue,
        always: RUNNER_STATES.executingQueue,
      },
      commenting: {
        entry: queue.assignCommentQueue,
        always: RUNNER_STATES.executingQueue,
      },
      prReviewing: {
        entry: queue.assignPrReviewQueue,
        always: RUNNER_STATES.executingQueue,
      },
      prReviewSkipped: { type: "final" },
      prReviewAssigned: { type: "final" },
      prResponding: {
        entry: queue.assignPrRespondingQueue,
        always: RUNNER_STATES.executingQueue,
      },
      prRespondingHuman: {
        entry: queue.assignPrRespondingHumanQueue,
        always: RUNNER_STATES.executingQueue,
      },
      prPush: {
        entry: queue.assignPrPushQueue,
        always: RUNNER_STATES.executingQueue,
      },
      orchestrating: {
        entry: queue.assignOrchestrateQueue,
        always: RUNNER_STATES.executingQueue,
      },
      orchestrationWaiting: {
        entry: queue.assignOrchestrationWaitingQueue,
        always: RUNNER_STATES.executingQueue,
      },
      orchestrationComplete: {
        entry: queue.assignOrchestrationCompleteQueue,
        always: RUNNER_STATES.executingQueue,
      },
      mergeQueueLogging: {
        entry: queue.assignMergeQueueEntryQueue,
        always: RUNNER_STATES.executingQueue,
      },
      mergeQueueFailureLogging: {
        entry: queue.assignMergeQueueFailureQueue,
        always: RUNNER_STATES.executingQueue,
      },
      actionFailure: {
        entry: queue.assignActionFailureQueue,
        always: RUNNER_STATES.executingQueue,
      },
      processingDeployedStage: {
        entry: queue.assignDeployedStageQueue,
        always: RUNNER_STATES.executingQueue,
      },
      processingDeployedProd: {
        entry: queue.assignDeployedProdQueue,
        always: RUNNER_STATES.executingQueue,
      },
      processingDeployedStageFailure: {
        entry: queue.assignDeployedStageFailureQueue,
        always: RUNNER_STATES.executingQueue,
      },
      processingDeployedProdFailure: {
        entry: queue.assignDeployedProdFailureQueue,
        always: RUNNER_STATES.executingQueue,
      },
      processingCI: {
        always: [
          { target: "transitioningToReview", guard: "readyForReview" },
          // CI passed but todos not done — continue iterating to finish remaining work
          { target: "iterating", guard: "ciPassed" },
          { target: "blocking", guard: "maxFailuresReached" },
          { target: "iteratingFix", guard: "ciFailed" },
          { target: "iterating" },
        ],
      },
      awaitingMerge: {
        entry: queue.assignAwaitingMergeQueue,
        always: RUNNER_STATES.executingQueue,
      },
      processingMerge: {
        entry: queue.assignMergeQueue,
        always: RUNNER_STATES.executingQueue,
      },
      blocking: {
        entry: queue.assignBlockQueue,
        always: RUNNER_STATES.executingQueue,
      },
      branchRebased: { type: "final" },
      idle: { type: "final" },
      subIssueIdle: { type: "final" },
      invalidIteration: { type: "final" },
      alreadyBlocked: { type: "final" },
      error: { type: "final" },
    };
  })
  .refreshContext(ExampleContextLoader.refreshFromRunnerContext)
  .persistContext(async (_runnerCtx, domain) => {
    await persistIssueState(domain);
  })
  .beforeQueue((_runnerCtx, domain, queueLabel) => {
    if (!queueLabel) return;
    const repo = repositoryFor(domain);
    if (repo.appendHistoryEntry) {
      repo.appendHistoryEntry({
        phase: queueLabel,
        message: "⏳ Running...",
        timestamp: domain.workflowStartedAt ?? new Date().toISOString(),
        sha: domain.ciCommitSha ?? undefined,
        runLink: domain.workflowRunUrl ?? undefined,
      });
    }
  })
  .afterQueue((_runnerCtx, domain, queueLabel, completedActions, error) => {
    if (!queueLabel) return;
    const repo = repositoryFor(domain);
    if (!repo.updateLastHistoryEntry) return;

    const messages: string[] = [];
    let runUrl = domain.workflowRunUrl ?? undefined;
    let sha = domain.ciCommitSha ?? undefined;

    for (const { result } of completedActions) {
      if (result && typeof result === "object") {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- duck-typed action result inspection
        const r = result as Record<string, unknown>;
        if (typeof r.message === "string" && r.message)
          messages.push(r.message);
        if (typeof r.runUrl === "string") runUrl = r.runUrl;
        if (typeof r.sha === "string") sha = r.sha;
      }
    }

    const allPassed =
      !error &&
      completedActions.every(
        (a) =>
          a.result &&
          typeof a.result === "object" &&
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- duck-typed ok check
          (a.result as Record<string, unknown>).ok === true,
      );
    const statusEmoji = allPassed ? "✅" : "❌";
    const details = error
      ? error
      : messages.length > 0
        ? messages.join(" | ")
        : queueLabel;

    repo.updateLastHistoryEntry({
      message: `${statusEmoji} ${details}`,
      sha,
      runLink: runUrl,
    });
  })
  .build({
    id: "example",
  });
