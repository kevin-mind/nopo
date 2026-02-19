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

/** Guard args: use context.domain; action type is widened so factory accepts these guards */
type GuardArgs = {
  context: RunnerMachineContext<ExampleContext, { type: string }>;
};

function hasLabel(context: ExampleContext, label: string): boolean {
  return context.issue.labels.some(
    (l) => l.toLowerCase() === label.toLowerCase(),
  );
}

function triggeredBy(
  trigger: ExampleTrigger,
): ({ context }: GuardArgs) => boolean {
  return ({ context }: GuardArgs) => context.domain.trigger === trigger;
}

function _triggeredByAny(
  triggers: readonly ExampleTrigger[],
): ({ context }: GuardArgs) => boolean {
  return ({ context }: GuardArgs) => triggers.includes(context.domain.trigger);
}

/** Needs triage: no triaged/groomed labels */
function needsTriage({ context }: GuardArgs): boolean {
  if (context.domain.parentIssue !== null) return false;
  return !hasLabel(context.domain, "triaged");
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

// ---------------------------------------------------------------------------
// Trigger guards (Sprint 1 routing skeleton)
// ---------------------------------------------------------------------------

const triggeredByAssignment = triggeredBy("issue-assigned");
const triggeredByEdit = triggeredBy("issue-edited");
const triggeredByCI = triggeredBy("workflow-run-completed");
const triggeredByReview = triggeredBy("pr-review-submitted");
const triggeredByReviewRequest = triggeredBy("pr-review-requested");
const triggeredByTriage = triggeredBy("issue-triage");
const triggeredByComment = triggeredBy("issue-comment");
const triggeredByOrchestrate = triggeredBy("issue-orchestrate");

/** Orchestrate trigger + issue already groomed with sub-issues → orchestrate phases */
function triggeredByOrchestrateAndReady({ context }: GuardArgs): boolean {
  return triggeredByOrchestrate({ context }) && hasSubIssues({ context });
}

/** Orchestrate trigger + issue not yet groomed → should groom first */
function triggeredByOrchestrateAndNeedsGrooming({
  context,
}: GuardArgs): boolean {
  return triggeredByOrchestrate({ context }) && needsGrooming({ context });
}
const triggeredByPRReview = triggeredBy("pr-review");

/** PR review trigger + CI passed → run Claude review */
function prReviewWithCIPassed({ context }: GuardArgs): boolean {
  return triggeredByPRReview({ context }) && ciPassed({ context });
}

/** PR review trigger + CI not failed → no-op (assigned) */
function prReviewWithCINotFailed({ context }: GuardArgs): boolean {
  return triggeredByPRReview({ context }) && !ciFailed({ context });
}
const triggeredByPRResponse = triggeredBy("pr-response");
const triggeredByPRHumanResponse = triggeredBy("pr-human-response");
const triggeredByPRReviewApproved = triggeredBy("pr-review-approved");
const triggeredByPRPush = triggeredBy("pr-push");
const triggeredByReset = triggeredBy("issue-reset");
const triggeredByRetry = triggeredBy("issue-retry");
const triggeredByPivot = triggeredBy("issue-pivot");
const triggeredByMergeQueueEntry = triggeredBy("merge-queue-entered");
const triggeredByMergeQueueFailure = triggeredBy("merge-queue-failed");
const triggeredByPRMerged = triggeredBy("pr-merged");
const triggeredByDeployedStage = triggeredBy("deployed-stage");
const triggeredByDeployedProd = triggeredBy("deployed-prod");
const triggeredByDeployedStageFailure = triggeredBy("deployed-stage-failed");
const triggeredByDeployedProdFailure = triggeredBy("deployed-prod-failed");
const triggeredByGroom = triggeredBy("issue-groom");
const triggeredByGroomSummary = triggeredBy("issue-groom-summary");

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
  // Sub-issues are never groomed — they are already phases from parent grooming
  if (context.domain.parentIssue !== null) return false;
  const hasTriaged = hasLabel(context.domain, "triaged");
  const hasGroomed = hasLabel(context.domain, "groomed");
  return hasTriaged && !hasGroomed;
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

function allPhasesDone({ context }: GuardArgs): boolean {
  if (!hasLabel(context.domain, "groomed")) return false;
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

/** Parent in progress without sub-issues (invalid iteration) */
function isInvalidIteration({ context }: GuardArgs): boolean {
  if (context.domain.parentIssue !== null) return false;
  if (!hasLabel(context.domain, "groomed")) return false;
  if (context.domain.issue.projectStatus !== "In progress") return false;
  return !context.domain.issue.hasSubIssues;
}

/**
 * Check if the issue needs sub-issues created.
 * Placeholder: returns false (same as issues machine).
 */
function needsSubIssues(_guardContext: GuardArgs): boolean {
  return false;
}

export {
  needsTriage,
  canIterate,
  isInReview,
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
  allPhasesDone,
  maxFailuresReached,
  isSubIssue,
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
};
