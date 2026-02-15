/**
 * Service definitions for the invoke-based machine.
 *
 * Each service is a fromPromise actor that performs a side effect.
 * Default implementations auto-succeed (predict mode).
 * Real implementations are injected via .provide() (execute mode).
 */

import { fromPromise } from "xstate";
import type { MachineContext, Action } from "../../core/schemas.js";
import { actions } from "../../core/schemas.js";
import {
  emitStatus,
  emitAppendHistory,
  emitUpdateHistory,
  transitionToReview,
  handleCIFailure,
  blockIssue,
  orchestrate,
  allPhasesDone as allPhasesDoneActions,
  resetIssue,
  retryIssue,
  pushToDraft,
  logInvalidIteration,
  runClaude,
  runClaudeFixCI,
  runClaudeTriage,
  runClaudeComment,
  runClaudePRReview,
  runClaudePRResponse,
  runClaudePRHumanResponse,
  runClaudeGrooming,
  runClaudePivot,
  mergeQueueEntry,
  mergeQueueFailure,
  merged,
  deployedStage,
  deployedProd,
  deployedStageFailure,
  deployedProdFailure,
} from "./actions.js";
import { deriveBranchName } from "../../core/parser.js";
import { HISTORY_ICONS, HISTORY_MESSAGES } from "../../core/constants.js";
import type { ActionContext } from "../../core/types.js";

/**
 * Service input: the current machine context
 */
export interface ServiceInput {
  context: MachineContext;
  reason?: string;
}

/**
 * Service output: list of actions to execute
 */
export interface ServiceOutput {
  actions: Action[];
}

/**
 * Build actions for a given service name. This is the pure action-building
 * logic that both predict and execute modes share.
 */
export function buildActionsForService(
  serviceName: string,
  context: MachineContext,
  reason?: string,
): Action[] {
  const ctx: ActionContext = { context };

  switch (serviceName) {
    // History services
    case "historyIterationStarted":
      return emitAppendHistory(ctx, HISTORY_MESSAGES.ITERATING);
    case "historyCISuccess":
      return emitUpdateHistory(
        ctx,
        HISTORY_ICONS.ITERATING,
        HISTORY_MESSAGES.CI_PASSED,
      );
    case "historyReviewRequested":
      return emitAppendHistory(ctx, HISTORY_MESSAGES.REVIEW_REQUESTED);

    // Status services
    case "setWorking":
      return emitStatus(ctx, "In progress");
    case "setReview":
      return emitStatus(ctx, "In review");
    case "setInProgress":
      return [
        actions.updateProjectStatus.create({
          issueNumber: context.issue.number,
          status: "In progress",
        }),
      ];
    case "setDone":
      return [
        actions.updateProjectStatus.create({
          issueNumber: context.issue.number,
          status: "Done",
        }),
      ];
    case "setError":
      return [
        actions.updateProjectStatus.create({
          issueNumber: context.issue.number,
          status: "Error",
        }),
      ];

    // Iteration services
    case "incrementIteration":
      return [
        actions.incrementIteration.create({
          issueNumber: context.issue.number,
        }),
      ];
    case "clearFailures":
      return [
        actions.clearFailures.create({
          issueNumber: context.issue.number,
        }),
      ];

    // Issue services
    case "closeIssue":
      return [
        actions.closeIssue.create({
          issueNumber: context.issue.number,
          reason: "completed" as const,
        }),
      ];

    // Git services
    case "createBranch":
      return [
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
      ];

    // PR services
    case "createPR": {
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
    }
    case "convertToDraft": {
      if (!context.pr) return [];
      return [actions.convertPRToDraft.create({ prNumber: context.pr.number })];
    }
    case "mergePR": {
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
    }

    // Compound services
    case "transitionToReview":
      return transitionToReview(ctx);
    case "handleCIFailure":
      return handleCIFailure(ctx);
    case "blockIssue":
      return blockIssue(ctx);
    case "orchestrate":
      return orchestrate(ctx);
    case "allPhasesDone":
      return allPhasesDoneActions(ctx);
    case "resetIssue":
      return resetIssue(ctx);
    case "retryIssue":
      return retryIssue(ctx);
    case "pushToDraft":
      return pushToDraft(ctx);
    case "logInvalidIteration":
      return logInvalidIteration(ctx);

    // Claude services
    case "runClaude":
      return runClaude(ctx);
    case "runClaudeFixCI":
      return runClaudeFixCI(ctx);
    case "runClaudeTriage":
      return runClaudeTriage(ctx);
    case "runClaudeComment":
      return runClaudeComment(ctx);
    case "runClaudePRReview":
      return runClaudePRReview(ctx);
    case "runClaudePRResponse":
      return runClaudePRResponse(ctx);
    case "runClaudePRHumanResponse":
      return runClaudePRHumanResponse(ctx);
    case "runClaudeGrooming":
      return runClaudeGrooming(ctx);
    case "runClaudePivot":
      return runClaudePivot(ctx);

    // Merge queue / deployment logging
    case "logMergeQueueEntry":
      return mergeQueueEntry(ctx);
    case "logMergeQueueFailure":
      return mergeQueueFailure(ctx);
    case "logMerged":
      return merged(ctx);
    case "logDeployedStage":
      return deployedStage(ctx);
    case "logDeployedProd":
      return deployedProd(ctx);
    case "logDeployedStageFailure":
      return deployedStageFailure(ctx);
    case "logDeployedProdFailure":
      return deployedProdFailure(ctx);

    // Stop
    case "stopWithReason":
      return [actions.stop.create({ message: reason ?? "unknown" })];

    default:
      return [];
  }
}

/**
 * Create default stub services that auto-succeed.
 * Each returns actions built from the context.
 */
export function createDefaultServices() {
  const serviceNames = [
    "historyIterationStarted",
    "historyCISuccess",
    "historyReviewRequested",
    "setWorking",
    "setReview",
    "setInProgress",
    "setDone",
    "setError",
    "incrementIteration",
    "clearFailures",
    "closeIssue",
    "createBranch",
    "createPR",
    "convertToDraft",
    "mergePR",
    "transitionToReview",
    "handleCIFailure",
    "blockIssue",
    "orchestrate",
    "allPhasesDone",
    "resetIssue",
    "retryIssue",
    "pushToDraft",
    "logInvalidIteration",
    "runClaude",
    "runClaudeFixCI",
    "runClaudeTriage",
    "runClaudeComment",
    "runClaudePRReview",
    "runClaudePRResponse",
    "runClaudePRHumanResponse",
    "runClaudeGrooming",
    "runClaudePivot",
    "logMergeQueueEntry",
    "logMergeQueueFailure",
    "logMerged",
    "logDeployedStage",
    "logDeployedProd",
    "logDeployedStageFailure",
    "logDeployedProdFailure",
    "stopWithReason",
  ] as const;

  const services: Record<
    string,
    ReturnType<typeof fromPromise<ServiceOutput, ServiceInput>>
  > = {};

  for (const name of serviceNames) {
    services[name] = fromPromise<ServiceOutput, ServiceInput>(
      async ({ input }) => ({
        actions: buildActionsForService(name, input.context, input.reason),
      }),
    );
  }

  return services;
}
