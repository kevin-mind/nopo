/**
 * State Machine Plan - Event detection and planning
 *
 * Runs detect logic and outputs context_json plus skip/concurrency fields.
 * When not skipping, also derives the expected post-run state for verification.
 * Workflows pass context_json and expected_state_json into sm-run/sm-verify.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  deriveIssueActions,
  isDiscussionTrigger,
  type WorkflowContext,
} from "@more/statemachine";
import { detectEvent } from "./lib/router-impl.js";
import { predictExpectedState } from "./lib/expected-state.js";

async function run(): Promise<void> {
  const token = getRequiredInput("github_token");
  const projectNumber = parseInt(getOptionalInput("project_number") || "1", 10);
  const resourceNumber = getOptionalInput("resource_number") || "";
  const triggerType = getOptionalInput("trigger_type") || undefined;

  const unifiedContext = await detectEvent(token, resourceNumber, triggerType);

  // Build expected state prediction if not skipping
  let expectedStateJson = "";

  if (!unifiedContext.skip && !isDiscussionTrigger(unifiedContext.trigger)) {
    core.startGroup("Predict expected state");

    try {
      const octokit = github.getOctokit(token);
      const { owner, repo } = github.context.repo;

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- WorkflowContext shape is compatible
      const ctx = unifiedContext as unknown as WorkflowContext;

      const deriveResult = await deriveIssueActions({
        trigger: ctx.trigger,
        ctx,
        octokit,
        owner,
        repo,
        projectNumber,
        maxRetries: 5,
        botUsername: "nopo-bot",
      });

      if (deriveResult) {
        const result = predictExpectedState(deriveResult);
        if (result) {
          expectedStateJson = result;
        }
      }
    } catch (error) {
      core.warning(`Expected state prediction failed: ${error}`);
    }

    core.endGroup();
  }

  setOutputs({
    context_json: JSON.stringify(unifiedContext),
    skip: String(unifiedContext.skip),
    skip_reason: unifiedContext.skip_reason,
    concurrency_group: unifiedContext.concurrency_group,
    cancel_in_progress: String(unifiedContext.cancel_in_progress),
    expected_state_json: expectedStateJson,
  });
}

run().catch((err) => {
  process.exitCode = 1;
  throw err;
});
