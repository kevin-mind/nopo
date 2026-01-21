import * as core from "@actions/core";
import * as github from "@actions/github";
import { createActor } from "xstate";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../lib/index.js";
import type {
  MachineContext,
  TriggerType,
  CIResult,
  ReviewDecision,
  Action,
} from "./schemas/index.js";
import { buildMachineContext } from "./parser/index.js";
import { claudeMachine, getTriggerEvent } from "./machine/index.js";
import {
  executeActions,
  createRunnerContext,
  logRunnerSummary,
} from "./runner/index.js";
import type { GitHubEvent } from "./schemas/index.js";

/**
 * Parse trigger type from input
 */
function parseTrigger(input: string): TriggerType {
  const validTriggers: TriggerType[] = [
    "issue_assigned",
    "issue_edited",
    "issue_closed",
    "pr_review_requested",
    "pr_review_submitted",
    "pr_push",
    "workflow_run_completed",
    "issue_comment",
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

    default:
      throw new Error(`Unsupported trigger type: ${trigger}`);
  }
}

/**
 * Run the state machine and execute resulting actions
 */
async function run(): Promise<void> {
  try {
    // Parse inputs
    const token = getRequiredInput("github_token");
    const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
    const projectNumber = parseInt(getRequiredInput("project_number"), 10);
    const trigger = parseTrigger(getRequiredInput("trigger"));
    const ciResult = parseCIResult(getOptionalInput("ci_result"));
    const ciRunUrl = getOptionalInput("ci_run_url") || null;
    const ciCommitSha = getOptionalInput("ci_commit_sha") || null;
    const reviewDecision = parseReviewDecision(
      getOptionalInput("review_decision"),
    );
    const reviewer = getOptionalInput("reviewer") || null;
    const maxRetries = parseInt(getOptionalInput("max_retries") || "5", 10);
    const botUsername = getOptionalInput("bot_username") || "nopo-bot";
    const dryRun = getOptionalInput("dry_run") === "true";

    core.info(`Claude State Machine starting...`);
    core.info(`Issue: #${issueNumber}`);
    core.info(`Project: ${projectNumber}`);
    core.info(`Trigger: ${trigger}`);
    core.info(`Dry run: ${dryRun}`);

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
    const context = await buildMachineContext(octokit, event, projectNumber, {
      maxRetries,
      botUsername,
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

    // Create and run the state machine
    const actor = createActor(claudeMachine, { input: context });

    // Start the machine
    actor.start();

    // Get the snapshot after initial transitions
    const snapshot = actor.getSnapshot();
    const finalState = String(snapshot.value);
    const pendingActions = snapshot.context.pendingActions;

    core.info(`Machine final state: ${finalState}`);
    core.info(`Pending actions: ${pendingActions.length}`);

    // Create runner context
    const runnerContext = createRunnerContext(
      octokit,
      owner,
      repo,
      projectNumber,
      {
        dryRun,
      },
    );

    // Execute the actions
    const result = await executeActions(pendingActions, runnerContext);

    // Log summary
    logRunnerSummary(result);

    // Set outputs
    setOutputs({
      actions: JSON.stringify(pendingActions.map((a: Action) => a.type)),
      final_state: finalState,
      success: String(result.success),
      stopped_early: String(result.stoppedEarly),
      stop_reason: result.stopReason || "",
    });

    if (!result.success) {
      core.setFailed(`Some actions failed. Check the logs for details.`);
    }

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
