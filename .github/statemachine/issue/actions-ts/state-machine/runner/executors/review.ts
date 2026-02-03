import * as core from "@actions/core";
import type {
  ApplyReviewOutputAction,
  SubmitReviewAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { executeSubmitReview } from "./github.js";

// ============================================================================
// Review Output Types
// ============================================================================

/**
 * Structured output from the review prompt
 */
interface ReviewOutput {
  decision: "approve" | "request_changes" | "comment";
  body: string;
}

// ============================================================================
// Apply Review Output
// ============================================================================

/**
 * Execute applyReviewOutput action
 *
 * Processes Claude's structured output from a review action:
 * - Reads decision and body from structured output
 * - Submits the PR review using executeSubmitReview
 */
export async function executeApplyReviewOutput(
  action: ApplyReviewOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ submitted: boolean; decision: string }> {
  if (!structuredOutput) {
    throw new Error(
      "No structured output provided. Ensure runClaude action ran before applyReviewOutput.",
    );
  }

  const reviewOutput = structuredOutput as ReviewOutput;

  if (!reviewOutput.decision || !reviewOutput.body) {
    throw new Error(
      `Invalid review output: missing decision or body. Got: ${JSON.stringify(reviewOutput)}`,
    );
  }

  core.info(`Applying review output: ${reviewOutput.decision}`);
  core.startGroup("Review Output");
  core.info(JSON.stringify(reviewOutput, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would submit ${reviewOutput.decision} review on PR #${action.prNumber}`,
    );
    return { submitted: true, decision: reviewOutput.decision };
  }

  // Construct and execute the submitReview action
  const submitAction: SubmitReviewAction = {
    type: "submitReview",
    prNumber: action.prNumber,
    decision: reviewOutput.decision,
    body: reviewOutput.body,
    token: "review", // Always use review token for submitting reviews
  };

  return executeSubmitReview(submitAction, ctx);
}
