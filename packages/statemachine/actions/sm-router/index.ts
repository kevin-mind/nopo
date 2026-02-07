/**
 * Claude State Machine Router
 *
 * Routes to either the issue state machine or discussion state machine
 * based on the trigger type.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { createActor } from "xstate";
import {
  // Action utilities
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  // Workflow context
  parseWorkflowContext,
  isDiscussionTrigger as checkDiscussionTrigger,
  type WorkflowContext,
  // Issue machine
  claudeMachine,
  buildMachineContext,
  formatAgentNotesForPrompt,
  type TriggerType,
  // Discussion machine
  discussionMachine,
  buildDiscussionContext,
  type DiscussionTriggerType,
  type DiscussionCommand,
} from "@more/statemachine";

// ============================================================================
// Trigger Type Detection
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
 * Map final state to a human-readable transition name.
 */
function getTransitionName(finalState: string): string {
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

    // Issue states - Early detection states
    alreadyDone: "Already Done",
    alreadyBlocked: "Already Blocked",

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
// Main Entry Point
// ============================================================================

async function run(): Promise<void> {
  try {
    // Parse common inputs
    const mode = getOptionalInput("mode") || "derive";
    const token = getRequiredInput("github_token");
    const projectNumber = parseInt(getRequiredInput("project_number"), 10);
    const maxRetries = parseInt(getOptionalInput("max_retries") || "5", 10);
    const botUsername = getOptionalInput("bot_username") || "nopo-bot";

    // Parse unified context_json
    const contextJsonInput = getRequiredInput("context_json");
    const ctx = parseWorkflowContext(contextJsonInput);

    // Get trigger from context (already validated by schema)
    const trigger = ctx.trigger;

    core.info(`Router received context_json with trigger: ${trigger}`);
    core.info(
      `Job: ${ctx.job}, Resource: ${ctx.resource_type} #${ctx.resource_number}`,
    );

    // Create octokit
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // ========================================================================
    // ROUTE: Discussion Triggers
    // ========================================================================
    if (checkDiscussionTrigger(trigger)) {
      await runDiscussionMachine({
        mode,
        trigger: trigger as DiscussionTriggerType,
        ctx,
        octokit,
        owner,
        repo,
        maxRetries,
        botUsername,
      });
      return;
    }

    // ========================================================================
    // ROUTE: Issue/PR Triggers
    // ========================================================================
    await runIssueMachine({
      mode,
      trigger: trigger as TriggerType,
      ctx,
      octokit,
      owner,
      repo,
      projectNumber,
      maxRetries,
      botUsername,
    });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

// ============================================================================
// Discussion Machine Runner
// ============================================================================

interface DiscussionMachineOptions {
  mode: string;
  trigger: DiscussionTriggerType;
  ctx: WorkflowContext;
  octokit: ReturnType<typeof github.getOctokit>;
  owner: string;
  repo: string;
  maxRetries: number;
  botUsername: string;
}

async function runDiscussionMachine(
  options: DiscussionMachineOptions,
): Promise<void> {
  const { mode, trigger, ctx, octokit, owner, repo, maxRetries, botUsername } =
    options;

  // Extract discussion-specific fields from context
  const discussionNumber = parseInt(ctx.discussion_number || "0", 10);
  const commentId = ctx.comment_id || undefined;
  const commentBody = ctx.comment_body || undefined;
  const commentAuthor = ctx.comment_author || undefined;

  core.info(`Claude Discussion Machine starting...`);
  core.info(`Mode: ${mode}`);
  core.info(`Discussion: #${discussionNumber}`);
  core.info(`Trigger: ${trigger}`);

  // Get command from context (already parsed by detect-event)
  let command: DiscussionCommand | undefined = ctx.command;
  // Fallback: parse from comment body if not in context
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
    core.setFailed(
      `Failed to build discussion context for discussion #${discussionNumber}`,
    );
    return;
  }

  core.info(`Discussion context built successfully`);
  core.info(`Discussion title: ${context.discussion.title}`);
  core.info(`Comment count: ${context.discussion.commentCount}`);

  // Context-only mode: return context without running state machine
  if (mode === "context") {
    core.info("Context-only mode - skipping state machine");

    core.startGroup("Context JSON");
    core.info(JSON.stringify(context, null, 2));
    core.endGroup();

    setOutputs({
      actions_json: "[]",
      final_state: "context_only",
      transition_name: "Context Only",
      context_json: JSON.stringify(context),
      action_count: "0",
      discussion_number: String(discussionNumber),
    });
    return;
  }

  // Create and run the discussion state machine
  const actor = createActor(discussionMachine, { input: context });
  actor.start();

  const snapshot = actor.getSnapshot();
  const finalState = String(snapshot.value);
  const pendingActions = snapshot.context.pendingActions;
  const transitionName = getTransitionName(finalState);

  core.info(`Machine final state: ${finalState}`);
  core.info(`Transition: ${transitionName}`);
  core.info(`Derived actions: ${pendingActions.length}`);

  if (pendingActions.length > 0) {
    const actionTypes = pendingActions.map((a) => a.type);
    core.info(`Action types: ${actionTypes.join(", ")}`);
  }

  setOutputs({
    actions_json: JSON.stringify(pendingActions),
    final_state: finalState,
    transition_name: transitionName,
    context_json: JSON.stringify(context),
    action_count: String(pendingActions.length),
    discussion_number: String(discussionNumber),
  });

  actor.stop();
}

// ============================================================================
// Issue Machine Runner
// ============================================================================

interface IssueMachineOptions {
  mode: string;
  trigger: TriggerType;
  ctx: WorkflowContext;
  octokit: ReturnType<typeof github.getOctokit>;
  owner: string;
  repo: string;
  projectNumber: number;
  maxRetries: number;
  botUsername: string;
}

async function runIssueMachine(options: IssueMachineOptions): Promise<void> {
  const {
    mode,
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

  core.info(`Claude Issue State Machine starting...`);
  core.info(`Mode: ${mode}`);
  core.info(`Issue: #${issueNumber}`);
  core.info(`Project: ${projectNumber}`);
  core.info(`Trigger: ${trigger}`);

  // Map trigger types to their underlying GitHub event types
  // Some triggers (like issue-reset, issue-triage) are derived from other events
  const triggerToEventType: Record<string, string> = {
    "issue-assigned": "issue_assigned",
    "issue-edited": "issue_edited",
    "issue-closed": "issue_closed",
    "issue-triage": "issue_assigned",
    "issue-orchestrate": "issue_assigned",
    "issue-comment": "issue_comment",
    "issue-reset": "issue_comment",
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
  };

  const eventType = triggerToEventType[trigger] || trigger;

  // Build a GitHubEvent object for the state machine
  const event = {
    type: eventType,
    owner,
    repo,
    issueNumber,
    timestamp: workflowStartedAt,
    // Add CI-specific fields for workflow-run-completed triggers
    ...(ciResult && { result: ciResult }),
    ...(ciRunUrl && { runUrl: ciRunUrl }),
    ...(ciCommitSha && { headSha: ciCommitSha }),
    // Add review-specific fields for pr-review-submitted triggers
    ...(reviewDecision && { decision: reviewDecision }),
    ...(reviewer && { reviewer }),
  };

  // Build machine context
  const context = await buildMachineContext(
    octokit,
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
    core.setFailed(`Failed to build machine context for issue #${issueNumber}`);
    return;
  }

  core.info(`Context built successfully`);
  core.info(`Issue status: ${context.issue.projectStatus}`);
  core.info(
    `Sub-issues: ${context.issue.hasSubIssues ? context.issue.subIssues.length : 0}`,
  );
  core.info(`Current phase: ${context.currentPhase || "N/A"}`);
  core.info(`Iteration: ${context.issue.iteration}`);

  // Extract commonly needed context values
  const iteration = String(context.issue.iteration ?? 0);
  const phase =
    context.currentPhase !== null ? String(context.currentPhase) : "-";
  const parentIssueNumber = String(
    context.parentIssue?.number || context.issue.number,
  );
  const subIssueNumber = context.currentSubIssue?.number
    ? String(context.currentSubIssue.number)
    : "";

  // Format agent notes for prompt injection
  const agentNotes = formatAgentNotesForPrompt(context.issue.agentNotes);

  // Context-only mode: return context without running state machine
  if (mode === "context") {
    core.info("Context-only mode - skipping state machine");

    core.startGroup("Context JSON");
    core.info(JSON.stringify(context, null, 2));
    core.endGroup();

    setOutputs({
      actions_json: "[]",
      final_state: "context_only",
      transition_name: "Context Only",
      context_json: JSON.stringify(context),
      action_count: "0",
      iteration,
      phase,
      parent_issue_number: parentIssueNumber,
      pr_number: context.pr?.number ? String(context.pr.number) : "",
      commit_sha: context.ciCommitSha || "",
      sub_issue_number: subIssueNumber,
      agent_notes: agentNotes,
    });
    return;
  }

  // Create and run the state machine
  // Send DETECT event to trigger ONE state transition (event-based, not `always`)
  const actor = createActor(claudeMachine, { input: context });
  actor.start();
  actor.send({ type: "DETECT" });

  const snapshot = actor.getSnapshot();
  const finalState = String(snapshot.value);
  const pendingActions = snapshot.context.pendingActions;
  const transitionName = getTransitionName(finalState);

  core.info(`Machine final state: ${finalState}`);
  core.info(`Transition: ${transitionName}`);
  core.info(`Derived actions: ${pendingActions.length}`);

  if (pendingActions.length > 0) {
    const actionTypes = pendingActions.map((a) => a.type);
    core.info(`Action types: ${actionTypes.join(", ")}`);
  }

  // Extract PR and commit info for history linking
  const prNumber = context.pr?.number ? String(context.pr.number) : "";
  const commitSha = context.ciCommitSha || "";

  setOutputs({
    actions_json: JSON.stringify(pendingActions),
    final_state: finalState,
    transition_name: transitionName,
    context_json: JSON.stringify(context),
    action_count: String(pendingActions.length),
    iteration,
    phase,
    parent_issue_number: parentIssueNumber,
    pr_number: prNumber,
    commit_sha: commitSha,
    sub_issue_number: subIssueNumber,
    agent_notes: agentNotes,
  });

  actor.stop();
}

run();
