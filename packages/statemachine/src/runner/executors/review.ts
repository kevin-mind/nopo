/**
 * Review Executor
 *
 * Processes Claude's structured output from review actions.
 */

import * as core from "@actions/core";
import * as fs from "node:fs";
import type {
  ApplyReviewOutputAction,
  SubmitReviewAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../types.js";
import { executeSubmitReview } from "./github.js";
import {
  ReviewOutputSchema,
  parseOutput,
  type ReviewOutput,
} from "./output-schemas.js";

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
  let reviewOutput: ReviewOutput;

  // Try structured output first (in-process chaining), then fall back to file
  if (structuredOutput) {
    reviewOutput = parseOutput(ReviewOutputSchema, structuredOutput, "review");
    core.info("Using structured output from in-process chain");
  } else if (action.filePath && fs.existsSync(action.filePath)) {
    // Read from file (artifact passed between workflow matrix jobs)
    try {
      const content = fs.readFileSync(action.filePath, "utf-8");
      reviewOutput = parseOutput(
        ReviewOutputSchema,
        JSON.parse(content),
        "review file",
      );
      core.info(`Review output from file: ${action.filePath}`);
    } catch (error) {
      throw new Error(`Failed to parse review output from file: ${error}`);
    }
  } else {
    throw new Error(
      `No structured output provided and review output file not found at: ${action.filePath || "undefined"}. ` +
        "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
    );
  }

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
