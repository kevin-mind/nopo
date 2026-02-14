/**
 * ContextLoader — thin wrapper over buildMachineContext().
 *
 * Extracts the context-building logic from deriveIssueActions() into a clean
 * interface for use by sm-plan and other consumers.
 */

import * as core from "@actions/core";
import type { MachineContext } from "../../core/schemas.js";
import type { TriggerType } from "../../schemas/state.js";
import type { WorkflowContext } from "../../schemas/runner-context.js";
import { buildMachineContext } from "../../parser/state-parser.js";
import { agentNotesExtractor } from "../../parser/extractors.js";
import { formatAgentNotesForPrompt } from "@more/issue-state";
import { getTransitionName } from "../../runner/derive.js";
import type { DeriveResult, DeriveIssueOptions } from "../../runner/derive.js";
import type { MachineResult } from "./issue-machine.js";
import { IssueMachine } from "./issue-machine.js";

type OctokitLike = Parameters<typeof buildMachineContext>[0];
type GitHubEvent = Parameters<typeof buildMachineContext>[1];

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
 * Extracts the event-building logic that was inline in deriveIssueActions().
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
// Derive from Workflow (new machine path)
// ============================================================================

/**
 * Run the new invoke-based state machine from a WorkflowContext and return a DeriveResult.
 * This is the new-machine equivalent of deriveIssueActions().
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
