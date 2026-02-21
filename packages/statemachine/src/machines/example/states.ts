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

/** Build the common promptVars needed by the review prompt. */
function buildReviewPromptVars(
  context: Ctx,
  issueNumber: number,
): Record<string, string> {
  const target = context.domain.currentSubIssue ?? context.domain.issue;
  return {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: target.title,
    ISSUE_BODY: target.body,
    ISSUE_COMMENTS: target.comments.join("\n"),
    REVIEW_DECISION: context.domain.reviewDecision ?? "none",
    REVIEWER: "unknown",
    PR_NUMBER: String(context.domain.pr?.number ?? 0),
    HEAD_REF: context.domain.pr?.headRef ?? context.domain.branch ?? "",
    BASE_REF: context.domain.pr?.baseRef ?? "main",
    REPO_OWNER: context.domain.owner,
    REPO_NAME: context.domain.repo,
  };
}

// ---------------------------------------------------------------------------
// Fix state queue — aligns project status with milestone-computed status
// ---------------------------------------------------------------------------

function buildFixStateQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const ctx = context.domain;
  const issueNumber = ctx.issue.number;
  const expectedStatus = computeExpectedStatus(ctx);

  return [
    registry.updateStatus.create({
      issueNumber,
      status: expectedStatus,
    }),
  ];
}

function buildTriageQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
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
    );
  }
  return [
    ...prelude,
    registry.updateStatus.create({
      issueNumber,
      status: "In progress",
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
  const issueNumber = target.number;
  const actions: ExampleAction[] = [];

  if (prNumber && context.domain.pr?.isDraft) {
    actions.push(registry.markPRReady.create({ prNumber }));
  }
  if (prNumber) {
    actions.push(
      registry.requestReviewer.create({
        prNumber,
        reviewer: context.domain.reviewerUsername,
      }),
    );
  }

  actions.push(
    registry.updateStatus.create({
      issueNumber,
      status: "In review",
    }),
  );

  // Run Claude review inline (PAT-based reviewer requests don't trigger
  // workflow events, so we can't rely on pr-review-requested trigger)
  actions.push(
    registry.runClaudeReview.create({
      issueNumber,
      promptVars: buildReviewPromptVars(context, issueNumber),
    }),
    registry.applyReviewOutput.create({ issueNumber }),
  );

  return actions;
}

function buildReviewQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const sub = requireCurrentSubIssue(context);
  return [
    registry.updateStatus.create({
      issueNumber: sub.number,
      status: "In review",
    }),
  ];
}

function buildAwaitingMergeQueue(
  _context: Ctx,
  _registry: ExampleRegistry,
): ExampleAction[] {
  return [];
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
    );
  }
  return queue;
}

function buildDeployedStageQueue(
  _context: Ctx,
  _registry: ExampleRegistry,
): ExampleAction[] {
  return [];
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
  ];
}

function buildRetryQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const sub = requireCurrentSubIssue(context);
  const issueNumber = sub.number;
  return [
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
  _context: Ctx,
  _registry: ExampleRegistry,
): ExampleAction[] {
  return [];
}

function buildPrReviewQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const issueNumber = context.domain.issue.number;
  return [
    registry.runClaudeReview.create({
      issueNumber,
      promptVars: buildReviewPromptVars(context, issueNumber),
    }),
    registry.applyReviewOutput.create({
      issueNumber,
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
  ];
}

function buildPrRespondingHumanQueue(
  _context: Ctx,
  _registry: ExampleRegistry,
): ExampleAction[] {
  return [];
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
  ];
}

function buildAwaitingReviewQueue(
  context: Ctx,
  registry: ExampleRegistry,
): ExampleAction[] {
  const target = context.domain.currentSubIssue ?? context.domain.issue;
  const prNumber = context.domain.pr?.number;
  const issueNumber = target.number;
  const actions: ExampleAction[] = [];

  // Ensure status is "In review" (idempotent)
  if (target.projectStatus !== "In review") {
    actions.push(
      registry.updateStatus.create({
        issueNumber,
        status: "In review",
      }),
    );
  }

  // Re-request reviewer if PR exists (idempotent, non-fatal)
  if (prNumber) {
    actions.push(
      registry.requestReviewer.create({
        prNumber,
        reviewer: context.domain.reviewerUsername,
      }),
    );
  }

  // Run Claude review inline if CI is passing
  if (context.domain.ciResult === "success") {
    actions.push(
      registry.runClaudeReview.create({
        issueNumber,
        promptVars: buildReviewPromptVars(context, issueNumber),
      }),
      registry.applyReviewOutput.create({ issueNumber }),
    );
  }

  return actions;
}

function buildOrchestrationWaitingQueue(
  _context: Ctx,
  _registry: ExampleRegistry,
): ExampleAction[] {
  return [];
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
  ];
}

function buildMergeQueueEntryQueue(
  _context: Ctx,
  _registry: ExampleRegistry,
): ExampleAction[] {
  return [];
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
    return [
      registry.updateStatus.create({
        issueNumber,
        status: "Blocked",
      }),
    ];
  }

  // Sub-issue or parent blocking (max failures)
  const issueNumber = currentSub?.number ?? context.domain.issue.number;
  return [
    registry.updateStatus.create({
      issueNumber,
      status: "Blocked",
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
  ];
}

function buildActionFailureQueue(
  _context: Ctx,
  _registry: ExampleRegistry,
): ExampleAction[] {
  return [];
}

type AssignType = typeof assign<
  Ctx,
  AnyEventObject,
  undefined,
  EventObject,
  never
>;

function assignQueue(
  label: string,
  builder: (context: Ctx, registry: ExampleRegistry) => ExampleAction[],
  registry: ExampleRegistry,
): ReturnType<AssignType> {
  return assign<Ctx, AnyEventObject, undefined, EventObject, never>({
    actionQueue: ({ context }) => builder(context, registry),
    queueLabel: () => label,
  });
}

export function createExampleQueueAssigners(registry: ExampleRegistry) {
  return {
    assignFixStateQueue: assignQueue("fix-state", buildFixStateQueue, registry),
    assignPrepareQueue: assignQueue("prepare", buildPrepareQueue, registry),
    assignBlockQueue: assignQueue("block", buildBlockQueue, registry),
    assignInitializingQueue: assignQueue(
      "initialize",
      buildInitializingQueue,
      registry,
    ),
    assignIterateFixQueue: assignQueue(
      "iterate",
      buildIterateFixQueue,
      registry,
    ),
    assignTransitionToReviewQueue: assignQueue(
      "review",
      buildTransitionToReviewQueue,
      registry,
    ),
    assignCompletingReviewTransitionQueue: assignQueue(
      "review",
      buildCompletingReviewTransitionQueue,
      registry,
    ),
    assignTriageQueue: assignQueue("triage", buildTriageQueue, registry),
    assignIterateQueue: assignQueue("iterate", buildIterateQueue, registry),
    assignReviewQueue: assignQueue("review", buildReviewQueue, registry),
    assignGroomQueue: assignQueue("groom", buildGroomQueue, registry),
    assignAwaitingMergeQueue: assignQueue(
      "review",
      buildAwaitingMergeQueue,
      registry,
    ),
    assignMergeQueue: assignQueue("merge", buildMergeQueue, registry),
    assignDeployedStageQueue: assignQueue(
      "deploy",
      buildDeployedStageQueue,
      registry,
    ),
    assignDeployedProdQueue: assignQueue(
      "deploy",
      buildDeployedProdQueue,
      registry,
    ),
    assignDeployedStageFailureQueue: assignQueue(
      "deploy",
      buildDeployedStageFailureQueue,
      registry,
    ),
    assignDeployedProdFailureQueue: assignQueue(
      "deploy",
      buildDeployedProdFailureQueue,
      registry,
    ),
    assignPivotQueue: assignQueue("pivot", buildPivotQueue, registry),
    assignResetQueue: assignQueue("reset", buildResetQueue, registry),
    assignRetryQueue: assignQueue("retry", buildRetryQueue, registry),
    assignCommentQueue: assignQueue("comment", buildCommentQueue, registry),
    assignPrReviewQueue: assignQueue("review", buildPrReviewQueue, registry),
    assignPrRespondingQueue: assignQueue(
      "review",
      buildPrRespondingQueue,
      registry,
    ),
    assignPrRespondingHumanQueue: assignQueue(
      "review",
      buildPrRespondingHumanQueue,
      registry,
    ),
    assignPrPushQueue: assignQueue("iterate", buildPrPushQueue, registry),
    assignOrchestrateQueue: assignQueue(
      "orchestrate",
      buildOrchestrateQueue,
      registry,
    ),
    assignAwaitingReviewQueue: assignQueue(
      "review",
      buildAwaitingReviewQueue,
      registry,
    ),
    assignOrchestrationWaitingQueue: assignQueue(
      "orchestrate",
      buildOrchestrationWaitingQueue,
      registry,
    ),
    assignOrchestrationCompleteQueue: assignQueue(
      "orchestrate",
      buildOrchestrationCompleteQueue,
      registry,
    ),
    assignMergeQueueEntryQueue: assignQueue(
      "merge",
      buildMergeQueueEntryQueue,
      registry,
    ),
    assignMergeQueueFailureQueue: assignQueue(
      "merge",
      buildMergeQueueFailureQueue,
      registry,
    ),
    assignActionFailureQueue: assignQueue(
      "error",
      buildActionFailureQueue,
      registry,
    ),
  };
}
