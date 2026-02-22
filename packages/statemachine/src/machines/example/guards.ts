/**
 * Example guards — local implementations for routing.
 *
 * Self-contained: no imports from machines/issues or machines/discussions.
 * Each guard receives RunnerMachineContext and uses context.domain (ExampleContext).
 */

import { parseTodoStatsInSection } from "@more/issue-state";
import type { RunnerMachineContext } from "../../core/pev/types.js";
import type { ExampleContext } from "./context.js";
import type { ExampleTrigger } from "./events.js";
import { computeExpectedStatus, isStatusCompatible } from "./milestones.js";

/** Guard args: use context.domain; action type is widened so factory accepts these guards */
type GuardArgs = {
  context: RunnerMachineContext<ExampleContext, { type: string }>;
};

function triggeredBy(
  trigger: ExampleTrigger,
): ({ context }: GuardArgs) => boolean {
  return ({ context }: GuardArgs) => context.domain.trigger === trigger;
}

/** Wrap a guard so it only fires on the first cycle (cycleCount === 0) */
function firstCycleOnly(
  guard: ({ context }: GuardArgs) => boolean,
): ({ context }: GuardArgs) => boolean {
  return ({ context }: GuardArgs) =>
    context.cycleCount === 0 && guard({ context });
}

function _triggeredByAny(
  triggers: readonly ExampleTrigger[],
): ({ context }: GuardArgs) => boolean {
  return ({ context }: GuardArgs) => triggers.includes(context.domain.trigger);
}

/** Needs triage: status is null or Backlog (not yet triaged) */
function needsTriage({ context }: GuardArgs): boolean {
  if (context.domain.parentIssue !== null) return false;
  // Sub-issues created by grooming have "[Phase N]:" title prefix.
  // Check this to handle the race condition where issues.opened fires
  // before linkSubIssue completes (parentIssue is null due to timing).
  if (context.domain.issue.title.startsWith("[Phase")) return false;
  const status = context.domain.issue.projectStatus;
  return status === null || status === "Backlog";
}

/** Sub-issue can iterate: has parent, bot assigned to parent and sub-issue */
function canIterate({ context }: GuardArgs): boolean {
  if (context.domain.parentIssue === null) return false;
  const bot = context.domain.botUsername;
  if (!context.domain.parentIssue.assignees.includes(bot)) return false;
  return context.domain.issue.assignees.includes(bot);
}

/** In review: status is "In review" */
function isInReview({ context }: GuardArgs): boolean {
  return context.domain.issue.projectStatus === "In review";
}

/** In review on first cycle: ensures reviewer is requested before stopping */
function isInReviewFirstCycle({ context }: GuardArgs): boolean {
  return context.cycleCount === 0 && isInReview({ context });
}

/** Already done: status Done and PR merged */
function isAlreadyDone({ context }: GuardArgs): boolean {
  return (
    context.domain.issue.projectStatus === "Done" &&
    context.domain.pr?.state === "MERGED"
  );
}

/** Blocked */
function isBlocked({ context }: GuardArgs): boolean {
  return context.domain.issue.projectStatus === "Blocked";
}

/** Error status (terminal) */
function isError({ context }: GuardArgs): boolean {
  return context.domain.issue.projectStatus === "Error";
}

/** Bot assigned to current issue */
function botIsAssigned({ context }: GuardArgs): boolean {
  return context.domain.issue.assignees.includes(context.domain.botUsername);
}

/**
 * Status misalignment: project status doesn't match what milestones compute.
 * Only fires on first cycle (cycleCount === 0) to prevent looping after fix.
 */
function isStatusMisaligned({ context }: GuardArgs): boolean {
  if (context.cycleCount > 0) return false;
  const expected = computeExpectedStatus(context.domain);
  return !isStatusCompatible(context.domain.issue.projectStatus, expected);
}

// ---------------------------------------------------------------------------
// Trigger guards (Sprint 1 routing skeleton)
// ---------------------------------------------------------------------------

const triggeredByAssignment = triggeredBy("issue-assigned");
const triggeredByEdit = triggeredBy("issue-edited");
const triggeredByCI = firstCycleOnly(triggeredBy("workflow-run-completed"));
const triggeredByReview = firstCycleOnly(triggeredBy("pr-review-submitted"));
const triggeredByReviewRequest = firstCycleOnly(
  triggeredBy("pr-review-requested"),
);
const triggeredByTriage = firstCycleOnly(triggeredBy("issue-triage"));
const triggeredByComment = firstCycleOnly(triggeredBy("issue-comment"));
const triggeredByOrchestrate = triggeredBy("issue-orchestrate");

/** Orchestrate trigger + issue already groomed with sub-issues → orchestrate phases */
function triggeredByOrchestrateAndReady({ context }: GuardArgs): boolean {
  return triggeredByOrchestrate({ context }) && hasSubIssues({ context });
}

/** Orchestration already ran this invocation — stop looping */
function alreadyOrchestrated({ context }: GuardArgs): boolean {
  return context.cycleCount > 0 && hasSubIssues({ context });
}

/** Orchestrate trigger + issue not yet groomed → should groom first */
function triggeredByOrchestrateAndNeedsGrooming({
  context,
}: GuardArgs): boolean {
  return triggeredByOrchestrate({ context }) && needsGrooming({ context });
}
const triggeredByPRReview = firstCycleOnly(({ context }: GuardArgs) => {
  const t = context.domain.trigger;
  return t === "pr-review" || t === "pr-review-requested";
});

/** PR review trigger + CI passed → run Claude review */
function prReviewWithCIPassed({ context }: GuardArgs): boolean {
  return triggeredByPRReview({ context }) && ciPassed({ context });
}

/** PR review trigger + CI not failed → no-op (assigned) */
function prReviewWithCINotFailed({ context }: GuardArgs): boolean {
  return triggeredByPRReview({ context }) && !ciFailed({ context });
}
const triggeredByPRResponse = firstCycleOnly(triggeredBy("pr-response"));
const triggeredByPRHumanResponse = firstCycleOnly(
  triggeredBy("pr-human-response"),
);
const triggeredByPRReviewApproved = firstCycleOnly(
  triggeredBy("pr-review-approved"),
);
const triggeredByPRPush = firstCycleOnly(triggeredBy("pr-push"));
const triggeredByReset = firstCycleOnly(triggeredBy("issue-reset"));
const triggeredByRetry = firstCycleOnly(triggeredBy("issue-retry"));
const triggeredByPivot = firstCycleOnly(triggeredBy("issue-pivot"));
const triggeredByMergeQueueEntry = firstCycleOnly(
  triggeredBy("merge-queue-entered"),
);
const triggeredByMergeQueueFailure = firstCycleOnly(
  triggeredBy("merge-queue-failed"),
);
const triggeredByPRMerged = firstCycleOnly(triggeredBy("pr-merged"));
const triggeredByDeployedStage = firstCycleOnly(triggeredBy("deployed-stage"));
const triggeredByDeployedProd = firstCycleOnly(triggeredBy("deployed-prod"));
const triggeredByDeployedStageFailure = firstCycleOnly(
  triggeredBy("deployed-stage-failed"),
);
const triggeredByDeployedProdFailure = firstCycleOnly(
  triggeredBy("deployed-prod-failed"),
);
const triggeredByGroom = firstCycleOnly(triggeredBy("issue-groom"));
const triggeredByGroomSummary = firstCycleOnly(
  triggeredBy("issue-groom-summary"),
);

// ---------------------------------------------------------------------------
// CI/review guards (for skeleton branching)
// ---------------------------------------------------------------------------

function ciPassed({ context }: GuardArgs): boolean {
  return context.domain.ciResult === "success";
}

function ciFailed({ context }: GuardArgs): boolean {
  return context.domain.ciResult === "failure";
}

function reviewApproved({ context }: GuardArgs): boolean {
  return context.domain.reviewDecision === "APPROVED";
}

function reviewRequestedChanges({ context }: GuardArgs): boolean {
  return context.domain.reviewDecision === "CHANGES_REQUESTED";
}

function reviewCommented({ context }: GuardArgs): boolean {
  return context.domain.reviewDecision === "COMMENTED";
}

function needsGrooming({ context }: GuardArgs): boolean {
  // Sub-issues are never groomed — they are already phases from parent grooming.
  // Also check title prefix to handle race condition (see needsTriage comment).
  if (context.domain.parentIssue !== null) return false;
  if (context.domain.issue.title.startsWith("[Phase")) return false;
  // Needs grooming: has been triaged but not yet groomed (no sub-issues)
  const status = context.domain.issue.projectStatus;
  return status === "Triaged" && !context.domain.issue.hasSubIssues;
}

function hasSubIssues({ context }: GuardArgs): boolean {
  return (
    context.domain.parentIssue === null && context.domain.issue.hasSubIssues
  );
}

function currentPhaseInReview({ context }: GuardArgs): boolean {
  if (!hasSubIssues({ context })) return false;
  return context.domain.currentSubIssue?.projectStatus === "In review";
}

/** Current sub-issue is blocked → bubble up to parent */
function currentPhaseBlocked({ context }: GuardArgs): boolean {
  if (!hasSubIssues({ context })) return false;
  return context.domain.currentSubIssue?.projectStatus === "Blocked";
}

function allPhasesDone({ context }: GuardArgs): boolean {
  if (!hasSubIssues({ context })) return false;
  if (context.domain.issue.subIssues.length === 0) return false;
  return context.domain.issue.subIssues.every(
    (subIssue) =>
      subIssue.projectStatus === "Done" || subIssue.state === "CLOSED",
  );
}

/** All non-manual todos done (from ## Todos section) */
function todosDone({ context }: GuardArgs): boolean {
  const issue = context.domain.currentSubIssue ?? context.domain.issue;
  const stats = parseTodoStatsInSection(issue.body, "Todos");
  return stats.uncheckedNonManual === 0;
}

/** CI passed and todos done — ready to transition to review */
function readyForReview({ context }: GuardArgs): boolean {
  return ciPassed({ context }) && todosDone({ context });
}

/** ARC 25: CI trigger + ready for review → transitioningToReview */
function triggeredByCIAndReadyForReview({ context }: GuardArgs): boolean {
  return triggeredByCI({ context }) && readyForReview({ context });
}

/** ARC 26: CI trigger + should continue (fix CI) → iteratingFix */
function triggeredByCIAndShouldContinue({ context }: GuardArgs): boolean {
  return triggeredByCI({ context }) && ciFailed({ context });
}

/** ARC 27: CI trigger + should block (max failures) → blocking */
function triggeredByCIAndShouldBlock({ context }: GuardArgs): boolean {
  return triggeredByCI({ context }) && maxFailuresReached({ context });
}

/** ARC 29: Review trigger + approved → awaitingMerge */
function triggeredByReviewAndApproved({ context }: GuardArgs): boolean {
  return triggeredByReview({ context }) && reviewApproved({ context });
}

/** ARC 30: Review trigger + changes requested → iteratingFix */
function triggeredByReviewAndChanges({ context }: GuardArgs): boolean {
  return triggeredByReview({ context }) && reviewRequestedChanges({ context });
}

/** ARC 31: Review trigger + commented → reviewing */
function triggeredByReviewAndCommented({ context }: GuardArgs): boolean {
  return triggeredByReview({ context }) && reviewCommented({ context });
}

/** Circuit breaker: max CI failures reached */
function maxFailuresReached({ context }: GuardArgs): boolean {
  const failures = context.domain.issue.failures ?? 0;
  const max = context.domain.maxRetries ?? 3;
  return failures >= max;
}

/** Sub-issue context (has parent) */
function isSubIssue({ context }: GuardArgs): boolean {
  return context.domain.parentIssue !== null;
}

/**
 * Parent machine should iterate on current sub-issue inline.
 * True when: parent context (not a sub-issue), has a currentSubIssue,
 * bot is assigned, sub-issue is in a working state, and branch prep
 * hasn't already been done (branchPrepResult is null).
 */
function shouldIterateSubIssue({ context }: GuardArgs): boolean {
  if (context.domain.parentIssue !== null) return false;
  if (context.domain.branchPrepResult !== null) return false;
  // If there's an open PR, wait for CI — don't re-iterate
  if (context.domain.pr?.state === "OPEN") return false;
  const sub = context.domain.currentSubIssue;
  if (!sub) return false;
  const bot = context.domain.botUsername;
  if (!sub.assignees.includes(bot)) return false;
  return sub.projectStatus === "In progress" || sub.projectStatus === "Backlog";
}

/** Parent in progress without sub-issues (invalid iteration) */
function isInvalidIteration({ context }: GuardArgs): boolean {
  if (context.domain.parentIssue !== null) return false;
  const status = context.domain.issue.projectStatus;
  if (status !== "Groomed" && status !== "In progress") return false;
  return !context.domain.issue.hasSubIssues;
}

/**
 * Check if the issue needs sub-issues created.
 * Placeholder: returns false (same as issues machine).
 */
function needsSubIssues(_guardContext: GuardArgs): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Branch preparation guards (two-queue architecture)
// ---------------------------------------------------------------------------

/** Branch prep clean and ready for review — transition to review */
function branchPrepCleanAndReadyForReview({ context }: GuardArgs): boolean {
  return branchPrepClean({ context }) && readyForReview({ context });
}

/** Branch prep completed with no rebase needed — safe to continue to iterate */
function branchPrepClean({ context }: GuardArgs): boolean {
  return context.domain.branchPrepResult === "clean";
}

/** Branch prep clean but already iterated this run — stop and wait for CI */
function branchPrepCleanAfterIterate({ context }: GuardArgs): boolean {
  return branchPrepClean({ context }) && context.domain.hasIterated === true;
}

/** Branch was rebased and force-pushed — machine should stop so CI retriggers */
function branchPrepRebased({ context }: GuardArgs): boolean {
  return context.domain.branchPrepResult === "rebased";
}

/** Branch rebase failed due to conflicts — should block */
function branchPrepConflicts({ context }: GuardArgs): boolean {
  return context.domain.branchPrepResult === "conflicts";
}

export {
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
  hasSubIssues,
  currentPhaseInReview,
  currentPhaseBlocked,
  alreadyOrchestrated,
  allPhasesDone,
  maxFailuresReached,
  isSubIssue,
  shouldIterateSubIssue,
  isInvalidIteration,
  needsSubIssues,
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
  branchPrepCleanAfterIterate,
  branchPrepRebased,
  branchPrepConflicts,
};
