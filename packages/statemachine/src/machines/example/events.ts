/**
 * Example trigger/event model.
 *
 * Sprint 1 goal: normalize all supported GitHub trigger families into a
 * single canonical model for routing and context loading.
 */

/** All trigger types supported by the new example/issues architecture */
export type ExampleTrigger =
  | "issue-assigned"
  | "issue-edited"
  | "issue-closed"
  | "issue-triage"
  | "issue-groom"
  | "issue-groom-summary"
  | "issue-orchestrate"
  | "issue-comment"
  | "issue-pivot"
  | "issue-reset"
  | "issue-retry"
  | "pr-review-requested"
  | "pr-review-submitted"
  | "pr-review"
  | "pr-review-approved"
  | "pr-response"
  | "pr-human-response"
  | "pr-push"
  | "workflow-run-completed"
  | "merge-queue-entered"
  | "merge-queue-failed"
  | "pr-merged"
  | "deployed-stage"
  | "deployed-prod"
  | "deployed-stage-failed"
  | "deployed-prod-failed";

export type ExampleCIResult = "success" | "failure" | "cancelled" | "skipped";
export type ExampleReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED";

/**
 * Canonical machine events used by routing and state transitions.
 * DETECT remains the default entry event for trigger-based routing.
 */
export type ExampleMachineEvent =
  | { type: "START" }
  | { type: "DETECT" }
  | { type: "CI_SUCCESS" }
  | { type: "CI_FAILURE" }
  | { type: "REVIEW_APPROVED" }
  | { type: "REVIEW_CHANGES_REQUESTED" }
  | { type: "REVIEW_COMMENTED" }
  | { type: "PR_MERGED" }
  | { type: "CONTINUE" };

/**
 * Minimal shape needed for trigger->event mapping.
 */
interface EventResolutionContext {
  trigger: ExampleTrigger;
  ciResult: ExampleCIResult | null;
  reviewDecision: ExampleReviewDecision | null;
}

/**
 * Resolve a trigger context into the initial machine event.
 */
export function getTriggerEvent(
  context: EventResolutionContext,
): ExampleMachineEvent {
  switch (context.trigger) {
    case "workflow-run-completed":
      if (context.ciResult === "success") return { type: "CI_SUCCESS" };
      if (context.ciResult === "failure") return { type: "CI_FAILURE" };
      return { type: "START" };

    case "pr-review-submitted":
      switch (context.reviewDecision) {
        case "APPROVED":
          return { type: "REVIEW_APPROVED" };
        case "CHANGES_REQUESTED":
          return { type: "REVIEW_CHANGES_REQUESTED" };
        case "COMMENTED":
          return { type: "REVIEW_COMMENTED" };
        default:
          return { type: "START" };
      }

    case "pr-merged":
      return { type: "PR_MERGED" };

    default:
      return { type: "START" };
  }
}

/**
 * Workflow input shape (mirrors runner context/environment inputs).
 */
interface ExampleWorkflowContext {
  issue_number?: string;
  ci_result?: string;
  ci_run_url?: string;
  ci_commit_sha?: string;
  review_decision?: string;
  reviewer?: string;
  reviewer_login?: string;
  context_type?: string;
  context_description?: string;
  branch_name?: string;
}

/**
 * Normalized event consumed by the context loader.
 */
export interface ExampleNormalizedEvent {
  type: string;
  owner: string;
  repo: string;
  issueNumber: number;
  timestamp: string;
  result?: string;
  runUrl?: string;
  headSha?: string;
  decision?: string;
  reviewer?: string;
}

interface WorkflowEventFields {
  event: ExampleNormalizedEvent;
  commentContextType: "issue" | "pr" | null;
  commentContextDescription: string | null;
  branch: string | null;
  ciRunUrl: string | null;
  workflowStartedAt: string;
  workflowRunUrl: string | null;
}

const TRIGGER_TO_EVENT_TYPE: Record<ExampleTrigger, string> = {
  "issue-assigned": "issue_assigned",
  "issue-edited": "issue_edited",
  "issue-closed": "issue_closed",
  "issue-triage": "issue_assigned",
  "issue-groom": "issue_assigned",
  "issue-groom-summary": "issue_assigned",
  "issue-orchestrate": "issue_assigned",
  "issue-comment": "issue_comment",
  "issue-pivot": "issue_comment",
  "issue-reset": "issue_comment",
  "issue-retry": "issue_comment",
  "pr-review-requested": "pr_review_requested",
  "pr-review-submitted": "pr_review_submitted",
  "pr-review": "pr_review_submitted",
  "pr-review-approved": "pr_review_submitted",
  "pr-response": "pr_review_submitted",
  "pr-human-response": "pr_review_submitted",
  "pr-push": "pr_push",
  "workflow-run-completed": "workflow_run_completed",
  "merge-queue-entered": "merge_queue_entered",
  "merge-queue-failed": "merge_queue_failed",
  "pr-merged": "pr_merged",
  "deployed-stage": "deployed_stage",
  "deployed-prod": "deployed_prod",
  "deployed-stage-failed": "deployed_stage_failed",
  "deployed-prod-failed": "deployed_prod_failed",
};

/**
 * Normalize workflow inputs + environment metadata into a structured event.
 */
export function buildEventFromWorkflow(
  trigger: ExampleTrigger,
  ctx: ExampleWorkflowContext,
  owner: string,
  repo: string,
): WorkflowEventFields {
  const issueNumber = Number.parseInt(ctx.issue_number ?? "0", 10);
  const ciResult = ctx.ci_result ?? null;
  const ciRunUrl = ctx.ci_run_url ?? null;
  const ciCommitSha = ctx.ci_commit_sha ?? null;
  const reviewDecision = ctx.review_decision ?? null;
  const reviewer = ctx.reviewer ?? ctx.reviewer_login ?? null;
  const contextType = ctx.context_type?.toLowerCase();
  const commentContextType =
    contextType === "issue" || contextType === "pr" ? contextType : null;
  const commentContextDescription = ctx.context_description ?? null;
  const branch = ctx.branch_name ?? null;
  const workflowStartedAt = new Date().toISOString();

  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY ?? `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID;
  const workflowRunUrl = runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : null;

  const event: ExampleNormalizedEvent = {
    type: TRIGGER_TO_EVENT_TYPE[trigger],
    owner,
    repo,
    issueNumber,
    timestamp: workflowStartedAt,
    ...(ciResult ? { result: ciResult } : {}),
    ...(ciRunUrl ? { runUrl: ciRunUrl } : {}),
    ...(ciCommitSha ? { headSha: ciCommitSha } : {}),
    ...(reviewDecision ? { decision: reviewDecision } : {}),
    ...(reviewer ? { reviewer } : {}),
  };

  return {
    event,
    commentContextType,
    commentContextDescription,
    branch,
    ciRunUrl,
    workflowStartedAt,
    workflowRunUrl,
  };
}
