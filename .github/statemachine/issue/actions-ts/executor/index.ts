import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../../../shared/lib/index.js";
import type { Action, TokenType } from "../state-machine/schemas/index.js";
import { ActionSchema } from "../state-machine/schemas/index.js";
import {
  executeActions,
  createRunnerContext,
  createSignaledRunnerContext,
  runWithSignaling,
  logRunnerSummary,
  type ResourceType,
  type RunnerResult,
} from "../state-machine/runner/index.js";

/**
 * Parse and validate actions JSON
 */
function parseActions(json: string): Action[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON: ${json.substring(0, 100)}...`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array, got: ${typeof parsed}`);
  }

  // Validate each action
  const actions: Action[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = ActionSchema.safeParse(parsed[i]);
    if (!result.success) {
      throw new Error(
        `Invalid action at index ${i}: ${result.error.message}\n` +
          `Action: ${JSON.stringify(parsed[i])}`,
      );
    }
    actions.push(result.data);
  }

  return actions;
}

/**
 * Execute actions from JSON input
 */
async function run(): Promise<void> {
  try {
    // Parse inputs - two tokens for different operations
    const codeToken = getRequiredInput("github_code_token");
    // Review token is optional - only needed for submit_review actions
    const reviewToken = getOptionalInput("github_review_token") || "";
    const actionsJson = getRequiredInput("actions_json");
    const projectNumber = parseInt(getRequiredInput("project_number"), 10);
    const dryRun = getOptionalInput("dry_run") === "true";
    const mockOutputsJson = getOptionalInput("mock_outputs") || "";

    // Parse mock outputs for test mode (skip real Claude calls)
    let mockOutputs: Record<string, Record<string, unknown>> | undefined;
    if (mockOutputsJson) {
      try {
        mockOutputs = JSON.parse(mockOutputsJson);
        core.info("[MOCK MODE] Mock outputs loaded for Claude calls");
      } catch (error) {
        core.warning(`Failed to parse mock_outputs: ${error}`);
      }
    }

    // Signaling inputs (optional)
    const job = getOptionalInput("job") || "";
    const resourceTypeInput = getOptionalInput("resource_type") || "issue";
    const resourceNumber = parseInt(
      getOptionalInput("resource_number") || "0",
      10,
    );
    const commentId = getOptionalInput("comment_id") || "";
    const runUrl = getOptionalInput("run_url") || "";

    // Validate resource type
    const resourceType: ResourceType =
      resourceTypeInput === "pr" ? "pr" : "issue";

    // Determine if signaling is enabled (requires job and resource_number)
    const signalingEnabled = job !== "" && resourceNumber > 0;

    core.info(`Claude State Executor starting...`);
    core.info(`Project: ${projectNumber}`);
    core.info(`Dry run: ${dryRun}`);
    core.info(`Signaling: ${signalingEnabled ? "enabled" : "disabled"}`);
    if (signalingEnabled) {
      core.info(`  Job: ${job}`);
      core.info(`  Resource: ${resourceType} #${resourceNumber}`);
    }

    // Parse and validate actions
    const actions = parseActions(actionsJson);
    core.info(`Actions to execute: ${actions.length}`);

    if (actions.length === 0) {
      core.info("No actions to execute");
      setOutputs({
        success: "true",
        stopped_early: "false",
        stop_reason: "",
        actions_executed: "0",
        actions_failed: "0",
        actions_skipped: "0",
        total_duration_ms: "0",
        results_json: "[]",
      });
      return;
    }

    // Log action types and tokens
    const actionTypes = actions.map((a) => a.type);
    core.info(`Action types: ${actionTypes.join(", ")}`);

    // Log which tokens each action will use
    const tokenUsage = actions.reduce(
      (acc, a) => {
        const token = a.token || "code";
        acc[token] = (acc[token] || 0) + 1;
        return acc;
      },
      {} as Record<TokenType, number>,
    );
    core.info(
      `Token usage: code=${tokenUsage.code || 0}, review=${tokenUsage.review || 0}`,
    );

    // Create octokits - code token is required, review token is optional
    const codeOctokit = github.getOctokit(codeToken);
    // Only create review octokit if token is provided (needed for submit_review actions)
    const reviewOctokit = reviewToken
      ? github.getOctokit(reviewToken)
      : undefined;
    const { owner, repo } = github.context.repo;

    // Execute with or without signaling based on inputs
    let result: RunnerResult;

    if (signalingEnabled) {
      // Use signaled execution - posts status comments automatically
      const signaledContext = createSignaledRunnerContext(
        codeOctokit,
        owner,
        repo,
        projectNumber,
        resourceType,
        resourceNumber,
        job,
        runUrl,
        {
          dryRun,
          reviewOctokit,
          triggerCommentId: commentId || undefined,
          mockOutputs,
        },
      );

      result = await runWithSignaling(actions, signaledContext);
    } else {
      // Use regular execution - no status comments
      const runnerContext = createRunnerContext(
        codeOctokit,
        owner,
        repo,
        projectNumber,
        {
          dryRun,
          reviewOctokit,
          mockOutputs,
        },
      );

      result = await executeActions(actions, runnerContext);
    }

    // Log summary
    logRunnerSummary(result);

    // Calculate stats
    const executed = result.results.filter((r) => !r.skipped).length;
    const failed = result.results.filter(
      (r) => !r.success && !r.skipped,
    ).length;
    const skipped = result.results.filter((r) => r.skipped).length;

    // Prepare results for output (strip non-serializable error objects)
    const resultsForOutput = result.results.map((r) => ({
      action: r.action.type,
      success: r.success,
      skipped: r.skipped,
      error: r.error?.message,
      durationMs: r.durationMs,
    }));

    // Set outputs
    setOutputs({
      success: String(result.success),
      stopped_early: String(result.stoppedEarly),
      stop_reason: result.stopReason || "",
      actions_executed: String(executed),
      actions_failed: String(failed),
      actions_skipped: String(skipped),
      total_duration_ms: String(result.totalDurationMs),
      results_json: JSON.stringify(resultsForOutput),
    });

    if (!result.success) {
      core.setFailed(`${failed} action(s) failed. Check the logs for details.`);
    } else if (result.stoppedEarly) {
      // Fail when stopped early to trigger fail-fast on matrix jobs
      // This prevents subsequent actions from running when we've signaled
      // that execution should stop (e.g., branch rebased and pushed)
      core.setFailed(
        `Stopped early: ${result.stopReason || "unknown reason"}. ` +
          `Subsequent matrix jobs will be cancelled.`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
