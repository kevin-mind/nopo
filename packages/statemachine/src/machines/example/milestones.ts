/**
 * Milestone-based status computation.
 *
 * Pure functions that compute the expected project status from context
 * by walking an ordered milestone ladder. The highest milestone whose
 * preconditions are met determines the expected status.
 *
 * IMPORTANT: Only use DURABLE signals (observable on every run) — not
 * transient per-run context like ciResult or reviewDecision.
 *
 * Labels "triaged" and "groomed" are DEPRECATED — project statuses
 * (Triaged, Groomed) replace them. Milestones use artifact-based
 * signals: hasSubIssues, sub-issue statuses, PR state, bot assignment.
 * "Triaged" cannot be detected from artifacts so it is NOT a milestone;
 * the guard treats it as a valid intermediate between Backlog and Groomed.
 */

import type { ExampleContext, ExampleProjectStatus } from "./context.js";

type NonNullStatus = Exclude<ExampleProjectStatus, null>;

// ---------------------------------------------------------------------------
// Milestone types
// ---------------------------------------------------------------------------

type ParentMilestone = "backlog" | "groomed" | "working" | "done";

type SubIssueMilestone = "backlog" | "working" | "review" | "done";

// ---------------------------------------------------------------------------
// Parent milestones (highest → lowest)
// ---------------------------------------------------------------------------

const PARENT_MILESTONE_STATUS: Record<ParentMilestone, NonNullStatus> = {
  done: "Done",
  working: "In progress",
  groomed: "Groomed",
  backlog: "Backlog",
};

function computeParentMilestone(ctx: ExampleContext): ParentMilestone {
  // 3: All sub-issues Done/CLOSED
  if (
    ctx.issue.hasSubIssues &&
    ctx.issue.subIssues.length > 0 &&
    ctx.issue.subIssues.every(
      (s) => s.projectStatus === "Done" || s.state === "CLOSED",
    )
  ) {
    return "done";
  }

  // 2: At least one sub-issue active (In progress or In review)
  if (
    ctx.issue.hasSubIssues &&
    ctx.issue.subIssues.some(
      (s) =>
        s.state === "OPEN" &&
        (s.projectStatus === "In progress" || s.projectStatus === "In review"),
    )
  ) {
    return "working";
  }

  // 1: Has sub-issues → groomed (sub-issues are the artifact of grooming)
  if (ctx.issue.hasSubIssues) {
    return "groomed";
  }

  // 0: Backlog (default)
  return "backlog";
}

// ---------------------------------------------------------------------------
// Sub-issue milestones (highest → lowest)
// Uses only durable signals: PR state, assignees, labels.
// ---------------------------------------------------------------------------

const SUB_MILESTONE_STATUS: Record<SubIssueMilestone, NonNullStatus> = {
  done: "Done",
  review: "In review",
  working: "In progress",
  backlog: "Backlog",
};

function computeSubIssueMilestone(ctx: ExampleContext): SubIssueMilestone {
  // 3: PR merged
  if (ctx.pr?.state === "MERGED") {
    return "done";
  }

  // 2: Has open non-draft PR → review
  if (ctx.pr?.state === "OPEN" && !ctx.pr.isDraft) {
    return "review";
  }

  // 1: Bot assigned → working
  if (ctx.issue.assignees.includes(ctx.botUsername)) {
    return "working";
  }

  // 0: Backlog (default)
  return "backlog";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the expected project status from context.
 *
 * Dispatches to parent or sub-issue milestone computation based on
 * whether the issue has a parent (is a sub-issue) or not.
 */
export function computeExpectedStatus(ctx: ExampleContext): NonNullStatus {
  if (ctx.parentIssue !== null) {
    const milestone = computeSubIssueMilestone(ctx);
    return SUB_MILESTONE_STATUS[milestone];
  }
  const milestone = computeParentMilestone(ctx);
  return PARENT_MILESTONE_STATUS[milestone];
}

/**
 * Check if a status is compatible with the computed expected status.
 *
 * "Triaged" is a valid intermediate between Backlog and Groomed that
 * milestones cannot detect from artifacts alone. The triage action sets
 * this status, and we trust it.
 */
export function isStatusCompatible(
  actual: ExampleProjectStatus | null,
  expected: ExampleProjectStatus,
): boolean {
  if (actual === expected) return true;
  // null is equivalent to Backlog
  if (actual === null && expected === "Backlog") return true;
  // Triaged is between Backlog and Groomed — milestones can't detect it
  if (expected === "Backlog" && actual === "Triaged") return true;
  return false;
}
