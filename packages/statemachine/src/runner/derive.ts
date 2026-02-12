/**
 * Derive Actions
 *
 * Pure functions that run the state machine to derive actions.
 * Separates machine execution from GitHub Actions output-setting,
 * allowing reuse by sm-plan (detect) and sm-run (receives context from workflow).
 */

import * as core from "@actions/core";
import { createActor } from "xstate";
import type { Action } from "../schemas/actions.js";
import type { TriggerType } from "../schemas/runner-context.js";
import type { WorkflowContext } from "../schemas/runner-context.js";
import type { MachineContext } from "../schemas/state.js";
import type { DiscussionTriggerType } from "../schemas/discussion-triggers.js";
import type { DiscussionCommand } from "../schemas/discussion-context.js";
import { claudeMachine } from "../machine/machine.js";
import { buildMachineContext } from "../parser/state-parser.js";
import { buildDiscussionContext } from "../discussion/context-builder.js";
import { discussionMachine } from "../discussion/machine.js";
import { agentNotesExtractor } from "../parser/extractors.js";
import { formatAgentNotesForPrompt } from "@more/issue-state";

// ============================================================================
// Types
// ============================================================================

export interface DeriveResult {
  finalState: string;
  transitionName: string;
  pendingActions: Action[];
  /** Trigger type that initiated this derive */
  trigger: string;
  /** Iteration counter from issue context */
  iteration: string;
  /** Phase identifier (or "-" if none) */
  phase: string;
  /** Parent issue number (or issue number itself) */
  parentIssueNumber: string;
  /** Sub-issue number (or empty string) */
  subIssueNumber: string;
  /** PR number (or empty string) */
  prNumber: string;
  /** CI commit SHA (or empty string) */
  commitSha: string;
  /** Formatted agent notes for prompt injection */
  agentNotes: string;
  /** Machine context used for state derivation (available for issue derives only) */
  machineContext?: MachineContext;
}

export interface DeriveIssueOptions {
  trigger: TriggerType;
  ctx: WorkflowContext;
  octokit: Parameters<typeof buildMachineContext>[0];
  owner: string;
  repo: string;
  projectNumber: number;
  maxRetries: number;
  botUsername: string;
}

export interface DeriveDiscussionOptions {
  trigger: DiscussionTriggerType;
  ctx: WorkflowContext;
  octokit: Parameters<typeof buildDiscussionContext>[0];
  owner: string;
  repo: string;
  maxRetries: number;
  botUsername: string;
}

// ============================================================================
// Transition Name Mapping
// ============================================================================

/**
 * Map final state to a human-readable transition name.
 */
export function getTransitionName(finalState: string): string {
  const stateNames: Record<string, string> = {
    // Issue states - Triage flow
    triaging: "Triage",
    // Issue states - Reset flow
    resetting: "Reset",
    // Issue states - Comment flow
    commenting: "Comment",
    // Issue states - PR review flows
    prReviewing: "PR Review",
    prResponding: "PR Response",
    prRespondingHuman: "PR Human Response",
    prPush: "PR Push",
    // Issue states - Orchestration flows
    orchestrationRunning: "Orchestrate",
    orchestrationWaiting: "Wait (Review)",
    orchestrationComplete: "Complete Phases",
    // Issue states - CI/merge/review processing
    processingCI: "CI Result",
    processingMerge: "Merge",
    processingReview: "Review Result",
    // Issue states - Iteration flows
    iterating: "Iterate",
    iteratingFix: "Fix CI",
    // Issue states - Review/transition flows
    reviewing: "In Review",
    transitioningToReview: "Request Review",
    // Issue states - Terminal states
    blocked: "Blocked",
    error: "Error",
    done: "Done",
    // Issue states - Merge queue logging states
    mergeQueueLogging: "Log Queue Entry",
    mergeQueueFailureLogging: "Log Queue Failure",
    mergedLogging: "Log Merged",
    deployedStageLogging: "Log Stage Deploy",
    deployedProdLogging: "Log Prod Deploy",
    deployedStageFailureLogging: "Log Stage Deploy Failure",
    deployedProdFailureLogging: "Log Prod Deploy Failure",
    // Issue states - Early detection states
    alreadyDone: "Already Done",
    alreadyBlocked: "Already Blocked",
    // Issue states - Pivot flow
    pivoting: "Pivot",
    // Issue states - Retry flow
    retrying: "Retry",
    // Issue states - Grooming flow
    grooming: "Grooming",
    // Discussion states
    detecting: "Detecting",
    researching: "Research",
    responding: "Respond",
    commanding: "Command",
    summarizing: "Summarize",
    planning: "Plan",
    completing: "Complete",
    skipped: "Skipped",
    noContext: "No Context",
  };

  return stateNames[finalState] || finalState;
}

// ============================================================================
// Trigger-to-Event Mapping
// ============================================================================

const TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  "issue-assigned": "issue_assigned",
  "issue-edited": "issue_edited",
  "issue-closed": "issue_closed",
  "issue-triage": "issue_assigned",
  "issue-orchestrate": "issue_assigned",
  "issue-comment": "issue_comment",
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

// ============================================================================
// Issue Machine Derivation
// ============================================================================

/**
 * Run the issue state machine and return derived actions.
 * Pure function — no GitHub Actions outputs are set.
 */
export async function deriveIssueActions(
  options: DeriveIssueOptions,
): Promise<DeriveResult | null> {
  const {
    trigger,
    ctx,
    octokit,
    owner,
    repo,
    projectNumber,
    maxRetries,
    botUsername,
  } = options;

  // Extract issue-specific fields from context
  const issueNumber = parseInt(ctx.issue_number || "0", 10);
  const ciResult = ctx.ci_result || null;
  const ciRunUrl = ctx.ci_run_url || null;
  const ciCommitSha = ctx.ci_commit_sha || null;
  const reviewDecision = ctx.review_decision || null;
  const reviewer = ctx.reviewer || ctx.reviewer_login || null;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- context_type is a known string enum
  const commentContextType = (ctx.context_type?.toLowerCase() || null) as
    | "issue"
    | "pr"
    | null;
  const commentContextDescription = ctx.context_description || null;
  const inputBranch = ctx.branch_name || null;
  const workflowStartedAt = new Date().toISOString();

  // Build workflow run URL from environment variables
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID;
  const workflowRunUrl = runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : null;

  core.info(`Derive issue actions: issue=#${issueNumber}, trigger=${trigger}`);

  const eventType = TRIGGER_TO_EVENT_TYPE[trigger] || trigger;

  // Build a GitHubEvent object for the state machine
  const event = {
    type: eventType,
    owner,
    repo,
    issueNumber,
    timestamp: workflowStartedAt,
    ...(ciResult && { result: ciResult }),
    ...(ciRunUrl && { runUrl: ciRunUrl }),
    ...(ciCommitSha && { headSha: ciCommitSha }),
    ...(reviewDecision && { decision: reviewDecision }),
    ...(reviewer && { reviewer }),
  };

  // Build machine context
  const context = await buildMachineContext(
    octokit,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- event object matches buildMachineContext parameter type
    event as Parameters<typeof buildMachineContext>[1],
    projectNumber,
    {
      maxRetries,
      botUsername,
      commentContextType,
      commentContextDescription,
      branch: inputBranch,
      triggerOverride: trigger,
      ciRunUrl,
      workflowStartedAt,
      workflowRunUrl,
    },
  );

  if (!context) {
    return null;
  }

  core.info(
    `Context built: status=${context.issue.projectStatus}, iteration=${context.issue.iteration}`,
  );

  // Extract commonly needed context values
  const iteration = String(context.issue.iteration ?? 0);
  const phase =
    context.currentPhase !== null ? String(context.currentPhase) : "-";
  const parentIssueNum = String(
    context.parentIssue?.number || context.issue.number,
  );
  const subIssueNum = context.currentSubIssue?.number
    ? String(context.currentSubIssue.number)
    : "";

  // Format agent notes for prompt injection
  const agentNotesEntries = agentNotesExtractor({
    owner,
    repo,
    issue: context.issue,
    parentIssue: context.parentIssue ?? null,
  });
  const agentNotes = formatAgentNotesForPrompt(agentNotesEntries);

  // Create and run the state machine
  const actor = createActor(claudeMachine, { input: context });
  actor.start();
  actor.send({ type: "DETECT" });

  const snapshot = actor.getSnapshot();
  const finalState = String(snapshot.value);
  const pendingActions = snapshot.context.pendingActions;
  const transitionName = getTransitionName(finalState);

  core.info(
    `Machine: state=${finalState}, transition=${transitionName}, actions=${pendingActions.length}`,
  );

  actor.stop();

  return {
    finalState,
    transitionName,
    pendingActions,
    trigger,
    iteration,
    phase,
    parentIssueNumber: parentIssueNum,
    subIssueNumber: subIssueNum,
    prNumber: context.pr?.number ? String(context.pr.number) : "",
    commitSha: context.ciCommitSha || "",
    agentNotes,
    machineContext: context,
  };
}

// ============================================================================
// Discussion Machine Derivation
// ============================================================================

/**
 * Parse discussion command from comment body
 */
function parseDiscussionCommand(body: string): DiscussionCommand | undefined {
  const trimmed = body.trim();
  if (trimmed === "/summarize") return "summarize";
  if (trimmed === "/plan") return "plan";
  if (trimmed === "/complete") return "complete";
  return undefined;
}

/**
 * Run the discussion state machine and return derived actions.
 * Pure function — no GitHub Actions outputs are set.
 */
export async function deriveDiscussionActions(
  options: DeriveDiscussionOptions,
): Promise<DeriveResult | null> {
  const { trigger, ctx, octokit, owner, repo, maxRetries, botUsername } =
    options;

  const discussionNumber = parseInt(ctx.discussion_number || "0", 10);
  const commentId = ctx.comment_id || undefined;
  const commentBody = ctx.comment_body || undefined;
  const commentAuthor = ctx.comment_author || undefined;

  core.info(
    `Derive discussion actions: discussion=#${discussionNumber}, trigger=${trigger}`,
  );

  // Get command from context or parse from comment body
  let command: DiscussionCommand | undefined = ctx.command;
  if (!command && commentBody) {
    command = parseDiscussionCommand(commentBody);
  }

  // Build discussion context
  const context = await buildDiscussionContext(
    octokit,
    owner,
    repo,
    discussionNumber,
    trigger,
    {
      commentId,
      commentBody,
      commentAuthor,
      command,
      maxRetries,
      botUsername,
    },
  );

  if (!context) {
    return null;
  }

  core.info(`Discussion context built: title=${context.discussion.title}`);

  // Create and run the discussion state machine
  const actor = createActor(discussionMachine, { input: context });
  actor.start();

  const snapshot = actor.getSnapshot();
  const finalState = String(snapshot.value);
  const pendingActions = snapshot.context.pendingActions;
  const transitionName = getTransitionName(finalState);

  core.info(
    `Machine: state=${finalState}, transition=${transitionName}, actions=${pendingActions.length}`,
  );

  actor.stop();

  return {
    finalState,
    transitionName,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- DiscussionAction token "admin" is compatible with Action at runtime
    pendingActions: pendingActions as unknown as Action[],
    trigger,
    iteration: "0",
    phase: "-",
    parentIssueNumber: "",
    subIssueNumber: "",
    prNumber: "",
    commitSha: "",
    agentNotes: "",
  };
}
