/**
 * Example domain states — routing and queue building.
 *
 * Exports atomic domain state parts so machine.ts can compose states explicitly.
 * Imports only from core and context.
 */

import { assign } from "xstate";
import type { AnyEventObject, EventObject } from "xstate";
import type { RunnerMachineContext } from "../../core/pev/types.js";
import type { ExampleContext } from "./context.js";
import type { ExampleAction, ExampleRegistry } from "./actions.js";
import { computeExpectedStatus } from "./milestones.js";

type Ctx = RunnerMachineContext<ExampleContext, ExampleAction>;

// ---------------------------------------------------------------------------
// Fix state queue — aligns project status with milestone-computed status
// ---------------------------------------------------------------------------

function buildFixStateQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const ctx = context.domain;
  const issueNumber = ctx.issue.number;
  const currentStatus = ctx.issue.projectStatus;
  const expectedStatus = computeExpectedStatus(ctx);

  return [
    registry.appendHistory.create({
      issueNumber,
      message: `State fix: ${String(currentStatus)} → ${String(expectedStatus)}`,
    }),
    registry.updateStatus.create({
      issueNumber,
      status: expectedStatus,
    }),
    registry.persistState.create({
      issueNumber,
      reason: "fix-status-misalignment",
    }),
  ];
}

function buildTriageQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.appendHistory.create({
      issueNumber,
      message: "Triaging issue",
      phase: "triage",
    }),
    registry.runClaudeTriage.create({
      issueNumber,
      promptVars: {
        ISSUE_NUMBER: String(issueNumber),
        ISSUE_TITLE: context.domain.issue.title,
        ISSUE_BODY: context.domain.issue.body,
        ISSUE_COMMENTS: context.domain.issue.comments.join("\n"),
      },
    }),
    registry.applyTriageOutput.create({
      issueNumber,
    }),
    registry.updateStatus.create({
      issueNumber,
      status: "Triaged",
    }),
  ];
}

function buildGroomQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.appendHistory.create({
      issueNumber,
      message: "Grooming issue",
      phase: "groom",
    }),
    registry.runClaudeGrooming.create({
      issueNumber,
      promptVars: {
        ISSUE_NUMBER: String(issueNumber),
        ISSUE_TITLE: context.domain.issue.title,
        ISSUE_BODY: context.domain.issue.body,
        ISSUE_COMMENTS: context.domain.issue.comments.join("\n"),
        ISSUE_LABELS: context.domain.issue.labels.join(", "),
      },
    }),
    registry.applyGroomingOutput.create({
      issueNumber,
    }),
    registry.reconcileSubIssues.create({
      issueNumber,
    }),
  ];
}

function requireCurrentSubIssue(context: Ctx) {
  const sub = context.domain.currentSubIssue;
  if (!sub) {
    throw new Error("Cannot operate without a currentSubIssue");
  }
  return sub;
}

function buildPrepareQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const sub = requireCurrentSubIssue(context);
  const branchName = context.domain.branch ?? `claude/issue/${sub.number}`;
  return [
    registry.setupGit.create({
      token: context.runnerCtx?.token ?? "",
    }),
    registry.prepareBranch.create({
      branchName,
    }),
  ];
}

function buildIterateQueue(
  context: Ctx,
  registry: ExampleRegistry,
  mode: "iterate" | "retry" = "iterate",
): ExampleAction[] {
  const sub = requireCurrentSubIssue(context);
  const issueNumber = sub.number;
  const prelude: ExampleAction[] = [];
  if (context.domain.ciResult === "failure") {
    prelude.push(
      registry.recordFailure.create({
        issueNumber,
        failureType: "ci",
      }),
      registry.appendHistory.create({
        issueNumber,
        message: "CI failed, returning to iteration",
        phase: "iterate",
      }),
    );
  }
  if (context.domain.reviewDecision === "CHANGES_REQUESTED") {
    prelude.push(
      registry.appendHistory.create({
        issueNumber,
        message: "Review requested changes, returning to iteration",
        phase: "review",
      }),
    );
  }
  return [
    ...prelude,
    registry.updateStatus.create({
      issueNumber,
      status: "In progress",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: mode === "retry" ? "Fixing CI" : "Starting iteration",
    }),
    registry.runClaudeIteration.create({
      issueNumber,
      mode,
      promptVars: {
        ISSUE_NUMBER: String(issueNumber),
        ISSUE_TITLE: sub.title,
        ISSUE_BODY: sub.body,
        ISSUE_COMMENTS: sub.comments.join("\n"),
        ISSUE_LABELS: sub.labels.join(", "),
        CI_RESULT: context.domain.ciResult ?? "none",
        REVIEW_DECISION: context.domain.reviewDecision ?? "none",
        ITERATION: String(sub.iteration ?? 0),
        LAST_CI_RESULT: context.domain.ciResult ?? "none",
        CONSECUTIVE_FAILURES: String(sub.failures ?? 0),
        BRANCH_NAME: context.domain.branch ?? `claude/issue/${issueNumber}`,
        PR_CREATE_COMMAND: [
          `gh pr create --draft`,
          `--title "fix: implement #${issueNumber}"`,
          `--body "Fixes #${issueNumber}"`,
          `--base main`,
          `--head ${context.domain.branch ?? `claude/issue/${issueNumber}`}`,
        ].join(" \\\n  "),
        AGENT_NOTES: "",
      },
    }),
    registry.applyIterationOutput.create({
      issueNumber,
    }),
  ];
}

function buildIterateFixQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  return buildIterateQueue(context, registry, "retry");
}

function buildTransitionToReviewQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const sub = context.domain.currentSubIssue ?? context.domain.issue;
  const branchName = context.domain.branch ?? `claude/issue/${sub.number}`;
  return [
    registry.setupGit.create({
      token: context.runnerCtx?.token ?? "",
    }),
    registry.prepareBranch.create({
      branchName,
    }),
  ];
}

function buildCompletingReviewTransitionQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const target = context.domain.currentSubIssue ?? context.domain.issue;
  const prNumber = context.domain.pr?.number;
  const actions: ExampleAction[] = [];

  if (prNumber && context.domain.pr?.isDraft) {
    actions.push(registry.markPRReady.create({ prNumber }));
  }
  if (prNumber) {
    actions.push(
      registry.requestReviewer.create({
        prNumber,
        reviewer: context.domain.botUsername,
      }),
    );
  }

  actions.push(
    registry.updateStatus.create({
      issueNumber: target.number,
      status: "In review",
    }),
    registry.appendHistory.create({
      issueNumber: target.number,
      message: "CI passed, transitioning to review",
      phase: "review",
    }),
    registry.persistState.create({
      issueNumber: target.number,
      reason: "review-transition",
    }),
  );

  return actions;
}

function buildReviewQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const sub = requireCurrentSubIssue(context);
  const prelude: ExampleAction[] =
    context.domain.reviewDecision === "COMMENTED"
      ? [
          registry.appendHistory.create({
            issueNumber: sub.number,
            message: "Review commented, staying in review",
            phase: "review",
          }),
        ]
      : [];
  return [
    ...prelude,
    registry.updateStatus.create({
      issueNumber: sub.number,
      status: "In review",
    }),
    registry.appendHistory.create({
      issueNumber: sub.number,
      message: "Requesting review",
    }),
  ];
}

function buildAwaitingMergeQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const sub = requireCurrentSubIssue(context);
  return [
    registry.appendHistory.create({
      issueNumber: sub.number,
      message: "Review approved, awaiting merge",
      phase: "review",
    }),
  ];
}

function buildMergeQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  const queue: ExampleAction[] = [
    registry.updateStatus.create({
      issueNumber,
      status: "Done",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "PR merged, issue marked done",
      phase: "review",
    }),
    registry.persistState.create({
      issueNumber,
      reason: "merge-complete",
    }),
  ];
  const needsOrchestration =
    context.domain.parentIssue !== null || context.domain.issue.hasSubIssues;
  if (needsOrchestration) {
    const parentNumber =
      context.domain.parentIssue?.number ?? context.domain.issue.number;
    queue.push(
      registry.runOrchestration.create({
        issueNumber: parentNumber,
        initParentIfNeeded: false,
      }),
      registry.appendHistory.create({
        issueNumber: parentNumber,
        message: "Orchestration command processed",
      }),
    );
  }
  return queue;
}

function buildDeployedStageQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.appendHistory.create({
      issueNumber,
      message: "Deployment to stage succeeded",
    }),
    registry.persistState.create({
      issueNumber,
      reason: "deploy-stage-success",
    }),
  ];
}

function buildDeployedProdQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Done",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Deployment to production succeeded",
    }),
    registry.persistState.create({
      issueNumber,
      reason: "deploy-prod-success",
    }),
  ];
}

function buildDeployedStageFailureQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Error",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Deployment to stage failed",
    }),
    registry.persistState.create({
      issueNumber,
      reason: "deploy-stage-failure",
    }),
  ];
}

function buildDeployedProdFailureQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Error",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Deployment to production failed",
    }),
    registry.persistState.create({
      issueNumber,
      reason: "deploy-prod-failure",
    }),
  ];
}

function buildPivotQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Blocked",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Pivot requested, blocking current path for replanning",
    }),
  ];
}

function buildResetQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Backlog",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Issue reset to backlog",
    }),
  ];
}

function buildRetryQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const sub = requireCurrentSubIssue(context);
  const issueNumber = sub.number;
  return [
    registry.appendHistory.create({
      issueNumber,
      message: "Retry requested, resuming iteration",
      phase: "iterate",
    }),
    registry.updateStatus.create({
      issueNumber,
      status: "In progress",
    }),
    registry.runClaudeIteration.create({
      issueNumber,
      mode: "retry",
      promptVars: {
        ISSUE_NUMBER: String(issueNumber),
        ISSUE_TITLE: sub.title,
        ISSUE_BODY: sub.body,
        ISSUE_COMMENTS: sub.comments.join("\n"),
        ISSUE_LABELS: sub.labels.join(", "),
        CI_RESULT: context.domain.ciResult ?? "none",
        REVIEW_DECISION: context.domain.reviewDecision ?? "none",
        ITERATION: String(sub.iteration ?? 0),
        LAST_CI_RESULT: context.domain.ciResult ?? "none",
        CONSECUTIVE_FAILURES: String(sub.failures ?? 0),
        BRANCH_NAME: context.domain.branch ?? `claude/issue/${issueNumber}`,
        PR_CREATE_COMMAND: [
          `gh pr create --draft`,
          `--title "fix: implement #${issueNumber}"`,
          `--body "Fixes #${issueNumber}"`,
          `--base main`,
          `--head ${context.domain.branch ?? `claude/issue/${issueNumber}`}`,
        ].join(" \\\n  "),
        AGENT_NOTES: "",
      },
    }),
    registry.applyIterationOutput.create({
      issueNumber,
    }),
  ];
}

function buildCommentQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  const suffix = context.domain.commentContextDescription
    ? ` (${context.domain.commentContextDescription})`
    : "";
  return [
    registry.appendHistory.create({
      issueNumber,
      message: `Issue comment trigger received${suffix}`,
    }),
  ];
}

function buildPrReviewQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.runClaudeReview.create({
      issueNumber,
      promptVars: {
        ISSUE_NUMBER: String(issueNumber),
        ISSUE_TITLE: context.domain.issue.title,
        ISSUE_BODY: context.domain.issue.body,
        ISSUE_COMMENTS: context.domain.issue.comments.join("\n"),
        REVIEW_DECISION: context.domain.reviewDecision ?? "none",
        REVIEWER: "unknown",
      },
    }),
    registry.applyReviewOutput.create({
      issueNumber,
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "PR review workflow requested",
      phase: "review",
    }),
  ];
}

function buildPrRespondingQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.runClaudePrResponse.create({
      issueNumber,
      promptVars: {
        ISSUE_NUMBER: String(issueNumber),
        ISSUE_TITLE: context.domain.issue.title,
        ISSUE_BODY: context.domain.issue.body,
        ISSUE_COMMENTS: context.domain.issue.comments.join("\n"),
        REVIEW_DECISION: context.domain.reviewDecision ?? "none",
        REVIEWER: "unknown",
      },
    }),
    registry.applyPrResponseOutput.create({
      issueNumber,
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Prepared automated PR response",
      phase: "review",
    }),
  ];
}

function buildPrRespondingHumanQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.appendHistory.create({
      issueNumber,
      message: "Human PR response required",
      phase: "review",
    }),
  ];
}

function buildPrPushQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "In progress",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "PR updated by push; awaiting CI and review loop",
      phase: "iterate",
    }),
  ];
}

function buildInitializingQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.runOrchestration.create({
      issueNumber,
      initParentIfNeeded: true,
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Initializing",
    }),
  ];
}

function buildOrchestrateQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  const status = context.domain.issue.projectStatus;
  const initParentIfNeeded = status === null || status === "Backlog";
  return [
    registry.runOrchestration.create({
      issueNumber,
      initParentIfNeeded,
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Orchestration command processed",
    }),
  ];
}

function buildOrchestrationWaitingQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.appendHistory.create({
      issueNumber,
      message: "Current phase is in review; waiting for merge before advancing",
      phase: "review",
    }),
  ];
}

function buildOrchestrationCompleteQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Done",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "All sub-issue phases are complete",
      phase: "review",
    }),
    registry.persistState.create({
      issueNumber,
      reason: "orchestration-complete",
    }),
  ];
}

function buildMergeQueueEntryQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.appendHistory.create({
      issueNumber,
      message: "Issue entered merge queue",
      phase: "review",
    }),
  ];
}

function buildBlockQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const isParent = context.domain.parentIssue === null;
  const currentSub = context.domain.currentSubIssue;

  // Parent blocking because current sub-issue is blocked → block the parent
  if (isParent && currentSub?.projectStatus === "Blocked") {
    const issueNumber = context.domain.issue.number;
    const subFailures = currentSub.failures ?? 0;
    return [
      registry.updateStatus.create({
        issueNumber,
        status: "Blocked",
      }),
      registry.appendHistory.create({
        issueNumber,
        message: `Blocked: Sub-issue #${currentSub.number} is blocked (${subFailures} failures)`,
      }),
      registry.persistState.create({
        issueNumber,
        reason: "sub-issue-blocked",
      }),
    ];
  }

  // Sub-issue or parent blocking (max failures)
  const issueNumber = currentSub?.number ?? context.domain.issue.number;
  const failures = (currentSub ?? context.domain.issue).failures ?? 0;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Blocked",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: `Blocked: Max failures reached (${failures})`,
      phase: "iterate",
    }),
  ];
}

function buildMergeQueueFailureQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Error",
    }),
    registry.appendHistory.create({
      issueNumber,
      message: "Merge queue failed",
      phase: "review",
    }),
    registry.persistState.create({
      issueNumber,
      reason: "merge-queue-failure",
    }),
  ];
}

function buildActionFailureQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  const message = context.error
    ? `Action execution failed: ${context.error}`
    : "Action execution failed";
  return [
    registry.appendHistory.create({
      issueNumber,
      message,
    }),
  ];
}

export function createExampleQueueAssigners(registry: ExampleRegistry) {
  const assignFixStateQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildFixStateQueue(context, registry),
  });

  const assignPrepareQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildPrepareQueue(context, registry),
  });

  const assignTriageQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildTriageQueue(context, registry),
  });

  const assignIterateQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildIterateQueue(context, registry),
  });

  const assignIterateFixQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildIterateFixQueue(context, registry),
  });

  const assignTransitionToReviewQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildTransitionToReviewQueue(context, registry),
  });

  const assignCompletingReviewTransitionQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildCompletingReviewTransitionQueue(context, registry),
  });

  const assignReviewQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildReviewQueue(context, registry),
  });
  const assignGroomQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildGroomQueue(context, registry),
  });

  const assignAwaitingMergeQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildAwaitingMergeQueue(context, registry),
  });

  const assignMergeQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildMergeQueue(context, registry),
  });

  const assignDeployedStageQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildDeployedStageQueue(context, registry),
  });

  const assignDeployedProdQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildDeployedProdQueue(context, registry),
  });

  const assignDeployedStageFailureQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildDeployedStageFailureQueue(context, registry),
  });

  const assignDeployedProdFailureQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildDeployedProdFailureQueue(context, registry),
  });

  const assignPivotQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildPivotQueue(context, registry),
  });

  const assignResetQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildResetQueue(context, registry),
  });

  const assignRetryQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildRetryQueue(context, registry),
  });

  const assignCommentQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildCommentQueue(context, registry),
  });

  const assignPrReviewQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildPrReviewQueue(context, registry),
  });

  const assignPrRespondingQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildPrRespondingQueue(context, registry),
  });

  const assignPrRespondingHumanQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildPrRespondingHumanQueue(context, registry),
  });

  const assignPrPushQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildPrPushQueue(context, registry),
  });

  const assignInitializingQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildInitializingQueue(context, registry),
  });

  const assignOrchestrateQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildOrchestrateQueue(context, registry),
  });

  const assignOrchestrationWaitingQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildOrchestrationWaitingQueue(context, registry),
  });

  const assignOrchestrationCompleteQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildOrchestrationCompleteQueue(context, registry),
  });

  const assignMergeQueueEntryQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildMergeQueueEntryQueue(context, registry),
  });

  const assignBlockQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildBlockQueue(context, registry),
  });

  const assignMergeQueueFailureQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) =>
      buildMergeQueueFailureQueue(context, registry),
  });

  const assignActionFailureQueue = assign<
    Ctx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => buildActionFailureQueue(context, registry),
  });

  return {
    assignFixStateQueue,
    assignPrepareQueue,
    assignBlockQueue,
    assignInitializingQueue,
    assignIterateFixQueue,
    assignTransitionToReviewQueue,
    assignCompletingReviewTransitionQueue,
    assignTriageQueue,
    assignIterateQueue,
    assignReviewQueue,
    assignGroomQueue,
    assignAwaitingMergeQueue,
    assignMergeQueue,
    assignDeployedStageQueue,
    assignDeployedProdQueue,
    assignDeployedStageFailureQueue,
    assignDeployedProdFailureQueue,
    assignPivotQueue,
    assignResetQueue,
    assignRetryQueue,
    assignCommentQueue,
    assignPrReviewQueue,
    assignPrRespondingQueue,
    assignPrRespondingHumanQueue,
    assignPrPushQueue,
    assignOrchestrateQueue,
    assignOrchestrationWaitingQueue,
    assignOrchestrationCompleteQueue,
    assignMergeQueueEntryQueue,
    assignMergeQueueFailureQueue,
    assignActionFailureQueue,
  };
}
