/**
 * Issue machine context loading and derivation.
 *
 * Provides ContextLoader for building MachineContext from GitHub API data,
 * and deriveIssueActions/deriveFromWorkflow for running the machine end-to-end.
 */

import * as core from "@actions/core";
import { createActor } from "xstate";
import type { Action } from "../../core/schemas/actions/index.js";
import type { MachineContext } from "../../core/schemas.js";
import type { TriggerType } from "../../core/schemas/state.js";
import type { WorkflowContext } from "../../core/schemas/runner-context.js";
import { buildMachineContext } from "../../core/parser/state-parser.js";
import { agentNotesExtractor } from "../../core/parser/extractors.js";
import { formatAgentNotesForPrompt } from "@more/issue-state";
import type { MachineResult } from "./machine.js";
import { IssueMachine } from "./machine.js";
import { issueInvokeMachine } from "./machine.js";

type OctokitLike = Parameters<typeof buildMachineContext>[0];
type GitHubEvent = Parameters<typeof buildMachineContext>[1];

// ============================================================================
// DeriveResult Types (moved from core/runner/derive.ts)
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

// ============================================================================
// Transition Name Mapping
// ============================================================================

/**
 * Map final state to a human-readable transition name.
 */
export function getTransitionName(finalState: string): string {
  const stateNames: Record<string, string> = {
    triaging: "Triage",
    resetting: "Reset",
    commenting: "Comment",
    prReviewing: "PR Review",
    prResponding: "PR Response",
    prRespondingHuman: "PR Human Response",
    prReviewSkipped: "PR Review Skipped",
    prReviewAssigned: "PR Review Assigned",
    prPush: "PR Push",
    orchestrationRunning: "Orchestrate",
    orchestrationWaiting: "Wait (Review)",
    orchestrationComplete: "Complete Phases",
    processingCI: "CI Result",
    processingMerge: "Merge",
    processingReview: "Review Result",
    iterating: "Iterate",
    iteratingFix: "Fix CI",
    reviewing: "In Review",
    transitioningToReview: "Request Review",
    blocked: "Blocked",
    error: "Error",
    done: "Done",
    mergeQueueLogging: "Log Queue Entry",
    mergeQueueFailureLogging: "Log Queue Failure",
    mergedLogging: "Log Merged",
    deployedStageLogging: "Log Stage Deploy",
    deployedProdLogging: "Log Prod Deploy",
    deployedStageFailureLogging: "Log Stage Deploy Failure",
    deployedProdFailureLogging: "Log Prod Deploy Failure",
    alreadyDone: "Already Done",
    alreadyBlocked: "Already Blocked",
    pivoting: "Pivot",
    retrying: "Retry",
    rebased: "Rebased",
    grooming: "Grooming",
    detecting: "Detecting",
    subIssueIdle: "Sub-Issue Idle",
    invalidIteration: "Invalid Iteration",
    initializing: "Initializing",
  };

  return stateNames[finalState] || finalState;
}

// ============================================================================
// Context Loader
// ============================================================================

/**
 * Options for loading machine context from GitHub.
 */
export interface ContextLoaderOptions {
  octokit: OctokitLike;
  owner: string;
  repo: string;
  projectNumber: number;
  maxRetries: number;
  botUsername: string;
  trigger: TriggerType;
  event: GitHubEvent;
  commentContextType?: "issue" | "pr" | null;
  commentContextDescription?: string | null;
  branch?: string | null;
  ciRunUrl?: string | null;
  workflowStartedAt?: string;
  workflowRunUrl?: string | null;
}

/**
 * Metadata fields extracted from MachineContext + MachineResult.
 * These are the fields that DeriveResult needs beyond the machine output.
 */
export interface DeriveMetadata {
  iteration: string;
  phase: string;
  parentIssueNumber: string;
  subIssueNumber: string;
  prNumber: string;
  commitSha: string;
  agentNotes: string;
}

/**
 * ContextLoader loads MachineContext from GitHub API data.
 */
export class ContextLoader {
  async load(options: ContextLoaderOptions): Promise<MachineContext | null> {
    return buildMachineContext(
      options.octokit,
      options.event,
      options.projectNumber,
      {
        maxRetries: options.maxRetries,
        botUsername: options.botUsername,
        commentContextType: options.commentContextType,
        commentContextDescription: options.commentContextDescription,
        branch: options.branch,
        triggerOverride: options.trigger,
        ciRunUrl: options.ciRunUrl,
        workflowStartedAt: options.workflowStartedAt,
        workflowRunUrl: options.workflowRunUrl,
      },
    );
  }
}

/**
 * Build the metadata fields that DeriveResult needs from machine context + result.
 * Keeps DeriveResult as the interchange format between sm-plan and sm-run.
 */
export function buildDeriveMetadata(
  machineContext: MachineContext,
  _machineResult: MachineResult,
): DeriveMetadata {
  const iteration = String(machineContext.issue.iteration ?? 0);
  const phase =
    machineContext.currentPhase !== null
      ? String(machineContext.currentPhase)
      : "-";
  const parentIssueNumber = String(
    machineContext.parentIssue?.number || machineContext.issue.number,
  );
  const subIssueNumber = machineContext.currentSubIssue?.number
    ? String(machineContext.currentSubIssue.number)
    : "";
  const prNumber = machineContext.pr?.number
    ? String(machineContext.pr.number)
    : "";
  const commitSha = machineContext.ciCommitSha || "";

  const agentNotesEntries = agentNotesExtractor({
    owner: machineContext.owner,
    repo: machineContext.repo,
    issue: machineContext.issue,
    parentIssue: machineContext.parentIssue ?? null,
  });
  const agentNotes = formatAgentNotesForPrompt(agentNotesEntries);

  return {
    iteration,
    phase,
    parentIssueNumber,
    subIssueNumber,
    prNumber,
    commitSha,
    agentNotes,
  };
}

// ============================================================================
// Workflow Event Building
// ============================================================================

/**
 * Fields extracted from a WorkflowContext for event building.
 */
export interface WorkflowEventFields {
  event: GitHubEvent;
  commentContextType: "issue" | "pr" | null;
  commentContextDescription: string | null;
  branch: string | null;
  ciRunUrl: string | null;
  workflowStartedAt: string;
  workflowRunUrl: string | null;
}

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

/**
 * Build a GitHubEvent + context fields from a WorkflowContext.
 */
export function buildEventFromWorkflow(
  trigger: TriggerType,
  ctx: WorkflowContext,
  owner: string,
  repo: string,
): WorkflowEventFields {
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
  const branch = ctx.branch_name || null;
  const workflowStartedAt = new Date().toISOString();

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID;
  const workflowRunUrl = runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : null;

  const eventType = TRIGGER_TO_EVENT_TYPE[trigger] || trigger;

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- event object matches buildMachineContext parameter type
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
  } as GitHubEvent;

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

// ============================================================================
// Issue Machine Derivation (moved from core/runner/derive.ts)
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
  const actor = createActor(issueInvokeMachine, { input: context });
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

/**
 * Run the invoke-based state machine from a WorkflowContext and return a DeriveResult.
 */
export async function deriveFromWorkflow(
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

  const fields = buildEventFromWorkflow(trigger, ctx, owner, repo);

  core.info(
    `Derive issue actions (new machine): issue=#${parseInt(ctx.issue_number || "0", 10)}, trigger=${trigger}`,
  );

  const loader = new ContextLoader();
  const context = await loader.load({
    octokit,
    owner,
    repo,
    projectNumber,
    maxRetries,
    botUsername,
    trigger,
    event: fields.event,
    commentContextType: fields.commentContextType,
    commentContextDescription: fields.commentContextDescription,
    branch: fields.branch,
    ciRunUrl: fields.ciRunUrl,
    workflowStartedAt: fields.workflowStartedAt,
    workflowRunUrl: fields.workflowRunUrl,
  });

  if (!context) {
    return null;
  }

  core.info(
    `Context built: status=${context.issue.projectStatus}, iteration=${context.issue.iteration}`,
  );

  const machine = new IssueMachine(context);
  const result = machine.predict();
  const transitionName = getTransitionName(result.state);
  const metadata = buildDeriveMetadata(context, result);

  core.info(
    `Machine: state=${result.state}, transition=${transitionName}, actions=${result.actions.length}`,
  );

  return {
    finalState: result.state,
    transitionName,
    pendingActions: result.actions,
    trigger,
    ...metadata,
    machineContext: context,
  };
}
