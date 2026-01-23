import * as core from "@actions/core";
import * as github from "@actions/github";
import { createActor } from "xstate";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../lib/index.js";
import type { TriggerType, CIResult, ReviewDecision } from "./schemas/index.js";
import { buildMachineContext } from "./parser/index.js";
import { claudeMachine } from "./machine/index.js";
import type { GitHubEvent } from "./schemas/index.js";

/**
 * Map final state to a human-readable transition name.
 * This gives meaningful labels to action sets in the UI.
 */
function getTransitionName(finalState: string): string {
  const stateNames: Record<string, string> = {
    // Triage flow
    triaging: "Triage",

    // Comment flow
    commenting: "Comment",

    // PR review flows
    prReviewing: "PR Review",
    prResponding: "PR Response",
    prRespondingHuman: "PR Human Response",

    // Orchestration flows
    orchestrationRunning: "Orchestrate",
    orchestrationWaiting: "Wait (Review)",
    orchestrationComplete: "Complete Phases",

    // Iteration flows
    iterating: "Iterate",
    iteratingFix: "Fix CI",

    // Review/transition flows
    reviewing: "In Review",
    transitioningToReview: "Request Review",

    // Terminal states
    blocked: "Blocked",
    error: "Error",
    done: "Done",

    // Merge queue logging states
    mergeQueueLogging: "Log Queue Entry",
    mergeQueueFailureLogging: "Log Queue Failure",
    mergedLogging: "Log Merged",
    deployedStageLogging: "Log Stage Deploy",
    deployedProdLogging: "Log Prod Deploy",

    // Early detection states
    alreadyDone: "Already Done",
    alreadyBlocked: "Already Blocked",
  };

  return stateNames[finalState] || finalState;
}

/**
 * Parse trigger type from input
 */
function parseTrigger(input: string): TriggerType {
  const validTriggers: TriggerType[] = [
    "issue_assigned",
    "issue_edited",
    "issue_closed",
    "issue_triage",
    "issue_orchestrate",
    "issue_comment",
    "pr_review_requested",
    "pr_review_submitted",
    "pr_review",
    "pr_review_approved",
    "pr_response",
    "pr_human_response",
    "pr_push",
    "workflow_run_completed",
    // Merge queue logging triggers
    "merge_queue_entered",
    "merge_queue_failed",
    "pr_merged",
    "deployed_stage",
    "deployed_prod",
  ];

  if (validTriggers.includes(input as TriggerType)) {
    return input as TriggerType;
  }

  throw new Error(`Invalid trigger type: ${input}`);
}

/**
 * Parse CI result from input
 */
function parseCIResult(input: string | undefined): CIResult | null {
  if (!input) return null;
  const validResults: CIResult[] = [
    "success",
    "failure",
    "cancelled",
    "skipped",
  ];
  if (validResults.includes(input as CIResult)) {
    return input as CIResult;
  }
  return null;
}

/**
 * Parse review decision from input
 */
function parseReviewDecision(input: string | undefined): ReviewDecision | null {
  if (!input) return null;
  const validDecisions: ReviewDecision[] = [
    "APPROVED",
    "CHANGES_REQUESTED",
    "COMMENTED",
    "DISMISSED",
  ];
  if (validDecisions.includes(input as ReviewDecision)) {
    return input as ReviewDecision;
  }
  return null;
}

/**
 * Build a GitHub event from inputs
 */
function buildEventFromInputs(
  owner: string,
  repo: string,
  trigger: TriggerType,
  issueNumber: number,
  options: {
    ciResult?: CIResult | null;
    ciRunUrl?: string | null;
    ciCommitSha?: string | null;
    reviewDecision?: ReviewDecision | null;
    reviewer?: string | null;
  },
): GitHubEvent {
  const base = { owner, repo };

  switch (trigger) {
    case "issue_assigned":
      return {
        ...base,
        type: "issue_assigned",
        issueNumber,
        assignee: "nopo-bot",
      };

    case "issue_edited":
      return {
        ...base,
        type: "issue_edited",
        issueNumber,
      };

    case "issue_closed":
      return {
        ...base,
        type: "issue_closed",
        issueNumber,
      };

    case "workflow_run_completed":
      return {
        ...base,
        type: "workflow_run_completed",
        workflowName: "CI",
        runId: 0,
        runUrl: options.ciRunUrl || "",
        headRef: "",
        headSha: options.ciCommitSha || "",
        result: options.ciResult || "success",
        issueNumber,
      };

    case "pr_review_submitted":
      return {
        ...base,
        type: "pr_review_submitted",
        prNumber: 0,
        issueNumber,
        reviewId: 0,
        reviewer: options.reviewer || "",
        decision: options.reviewDecision || "COMMENTED",
        headRef: "",
        baseRef: "main",
      };

    case "pr_review_requested":
      return {
        ...base,
        type: "pr_review_requested",
        prNumber: 0,
        issueNumber,
        requestedReviewer: "nopo-bot",
        headRef: "",
        baseRef: "main",
        isDraft: false,
      };

    case "pr_push":
      return {
        ...base,
        type: "pr_push",
        prNumber: 0,
        issueNumber,
        headRef: "",
        commitSha: options.ciCommitSha || "",
        wasDraft: false,
        isNowDraft: false,
      };

    case "issue_comment":
      return {
        ...base,
        type: "issue_comment",
        issueNumber,
        commentId: 0,
        commentBody: "",
        author: "",
        isPR: false,
      };

    case "issue_triage":
      // Triage uses issue_edited event type internally
      return {
        ...base,
        type: "issue_edited",
        issueNumber,
      };

    case "issue_orchestrate":
      // Orchestrate uses issue_edited event type internally
      return {
        ...base,
        type: "issue_edited",
        issueNumber,
      };

    case "pr_review":
      // Bot is requested to review a PR
      return {
        ...base,
        type: "pr_review_requested",
        prNumber: 0, // Will be derived from branch
        issueNumber,
        requestedReviewer: "nopo-bot",
        headRef: "",
        baseRef: "main",
        isDraft: false,
      };

    case "pr_response":
      // Bot responding to its own review
      return {
        ...base,
        type: "pr_review_submitted",
        prNumber: 0,
        issueNumber,
        reviewId: 0,
        reviewer: "claude[bot]", // Response to bot's own review
        decision: options.reviewDecision || "CHANGES_REQUESTED",
        headRef: "",
        baseRef: "main",
      };

    case "pr_human_response":
      // Bot responding to human review
      return {
        ...base,
        type: "pr_review_submitted",
        prNumber: 0,
        issueNumber,
        reviewId: 0,
        reviewer: options.reviewer || "", // Human reviewer
        decision: options.reviewDecision || "CHANGES_REQUESTED",
        headRef: "",
        baseRef: "main",
      };

    // Merge queue logging triggers
    case "merge_queue_entered":
      return {
        ...base,
        type: "merge_queue_entered",
        prNumber: 0, // Will be in context
        issueNumber,
        headRef: "",
      };

    case "merge_queue_failed":
      return {
        ...base,
        type: "merge_queue_failed",
        prNumber: 0,
        issueNumber,
        failureReason: options.ciRunUrl
          ? "See run link for details"
          : "Unknown failure",
      };

    case "pr_merged":
      return {
        ...base,
        type: "pr_merged",
        prNumber: 0,
        issueNumber,
        commitSha: options.ciCommitSha || "",
      };

    case "deployed_stage":
      return {
        ...base,
        type: "deployed_stage",
        issueNumber,
        commitSha: options.ciCommitSha || "",
      };

    case "deployed_prod":
      return {
        ...base,
        type: "deployed_prod",
        issueNumber,
        commitSha: options.ciCommitSha || "",
      };

    default:
      throw new Error(`Unsupported trigger type: ${trigger}`);
  }
}

/**
 * Run the state machine to derive actions from issue state
 *
 * This action only derives actions - it does not execute them.
 * Pass the output actions_json to claude-state-executor to execute.
 */
async function run(): Promise<void> {
  try {
    // Parse inputs
    const mode = getOptionalInput("mode") || "derive";
    const token = getRequiredInput("github_token");
    const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
    const projectNumber = parseInt(getRequiredInput("project_number"), 10);
    // Trigger is required for derive mode, optional for context mode
    const triggerInput =
      mode === "context"
        ? getOptionalInput("trigger") || "issue_edited"
        : getRequiredInput("trigger");
    const trigger = parseTrigger(triggerInput);
    const ciResult = parseCIResult(getOptionalInput("ci_result"));
    const ciRunUrl = getOptionalInput("ci_run_url") || null;
    const ciCommitSha = getOptionalInput("ci_commit_sha") || null;
    const reviewDecision = parseReviewDecision(
      getOptionalInput("review_decision"),
    );
    const reviewer = getOptionalInput("reviewer") || null;
    const commentContextType = getOptionalInput("comment_context_type") as
      | "Issue"
      | "PR"
      | undefined;
    const commentContextDescription =
      getOptionalInput("comment_context_description") || null;
    const inputBranch = getOptionalInput("branch") || null;
    const maxRetries = parseInt(getOptionalInput("max_retries") || "5", 10);
    const botUsername = getOptionalInput("bot_username") || "nopo-bot";
    // Workflow start time - use input if provided, otherwise use current time
    const workflowStartedAt =
      getOptionalInput("workflow_started_at") || new Date().toISOString();

    core.info(`Claude State Machine starting...`);
    core.info(`Mode: ${mode}`);
    core.info(`Issue: #${issueNumber}`);
    core.info(`Project: ${projectNumber}`);
    core.info(`Trigger: ${trigger}`);

    // Create octokit
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Build event from inputs
    const event = buildEventFromInputs(owner, repo, trigger, issueNumber, {
      ciResult,
      ciRunUrl,
      ciCommitSha,
      reviewDecision,
      reviewer,
    });

    // Build machine context
    // Pass the original trigger as override to preserve it
    // (some triggers like issue_triage use issue_edited event internally)
    const context = await buildMachineContext(octokit, event, projectNumber, {
      maxRetries,
      botUsername,
      commentContextType: commentContextType || null,
      commentContextDescription,
      branch: inputBranch,
      triggerOverride: trigger,
      ciRunUrl, // Pass through for merge queue/release logging
      workflowStartedAt,
    });

    if (!context) {
      core.setFailed(
        `Failed to build machine context for issue #${issueNumber}`,
      );
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

    // Context-only mode: return context without running state machine
    if (mode === "context") {
      core.info("Context-only mode - skipping state machine");

      // Log full context JSON for debugging visibility
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
      });
      return;
    }

    // Create and run the state machine
    const actor = createActor(claudeMachine, { input: context });

    // Start the machine
    actor.start();

    // Get the snapshot after initial transitions
    const snapshot = actor.getSnapshot();
    const finalState = String(snapshot.value);
    const pendingActions = snapshot.context.pendingActions;

    // Get transition name for human-readable output
    const transitionName = getTransitionName(finalState);

    core.info(`Machine final state: ${finalState}`);
    core.info(`Transition: ${transitionName}`);
    core.info(`Derived actions: ${pendingActions.length}`);

    // Log action types
    if (pendingActions.length > 0) {
      const actionTypes = pendingActions.map((a) => a.type);
      core.info(`Action types: ${actionTypes.join(", ")}`);
    }

    // Set outputs (actions as full JSON for executor)
    setOutputs({
      actions_json: JSON.stringify(pendingActions),
      final_state: finalState,
      transition_name: transitionName,
      context_json: JSON.stringify(context),
      action_count: String(pendingActions.length),
      iteration,
      phase,
      parent_issue_number: parentIssueNumber,
    });

    // Stop the actor
    actor.stop();
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
