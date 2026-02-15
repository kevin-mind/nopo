/**
 * State Machine Plan - Event detection and planning
 *
 * Runs detect logic and outputs context_json plus skip/concurrency fields.
 * When not skipping, also derives the expected post-run state for verification.
 * Workflows pass context_json and expected_state_json into sm-run/sm-verify.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  deriveIssueActions,
  IssueNextInvoke,
  isDiscussionTrigger,
  addHistoryEntry,
  type WorkflowContext,
  type DeriveResult,
} from "@more/statemachine";
import { detectEvent } from "./lib/router-impl.js";
import {
  predictExpectedState,
  predictExpectedStateNew,
} from "./lib/expected-state.js";

function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
  return octokit as unknown as OctokitLike;
}

/**
 * Write the "⏳ running..." history entry early so feedback is instant.
 * sm-run's logRunEnd will replace this with the actual outcome.
 */
async function logRunStart(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  deriveResult: DeriveResult,
): Promise<void> {
  const issueNumber = parseInt(deriveResult.parentIssueNumber || "0", 10);
  if (issueNumber <= 0) return;

  const iteration = parseInt(deriveResult.iteration, 10);
  const phase = deriveResult.phase;

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID || "";
  const runLink = `${serverUrl}/${repository}/actions/runs/${runId}`;
  const repoUrl = `${serverUrl}/${owner}/${repo}`;

  try {
    const { data, update } = await parseIssue(owner, repo, issueNumber, {
      octokit: asOctokitLike(octokit),
      fetchPRs: false,
      fetchParent: false,
    });

    const state = addHistoryEntry(
      {
        iteration,
        phase,
        action: "\u23f3 running...",
        timestamp: new Date().toISOString(),
        runLink,
        repoUrl,
      },
      data,
    );

    await update(state);
    core.info(`Logged run start for issue #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to log run start: ${error}`);
  }
}

async function run(): Promise<void> {
  const token = getRequiredInput("github_token");
  const projectNumber = parseInt(getOptionalInput("project_number") || "1", 10);
  const resourceNumber = getOptionalInput("resource_number") || "";
  const triggerType = getOptionalInput("trigger_type") || undefined;

  const unifiedContext = await detectEvent(token, resourceNumber, triggerType);

  // Build expected state prediction and derive result if not skipping
  let expectedStateJson = "";
  let deriveResultJson = "";

  const useNewMachine = getOptionalInput("use_new_machine") === "true";

  if (!unifiedContext.skip && !isDiscussionTrigger(unifiedContext.trigger)) {
    core.startGroup("Predict expected state");
    core.info("=".repeat(60));
    core.info(`MACHINE: ${useNewMachine ? ">>> INVOKE (NEW) <<<" : "legacy"}`);
    core.info("=".repeat(60));

    try {
      const octokit = github.getOctokit(token);
      const { owner, repo } = github.context.repo;

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- WorkflowContext shape is compatible
      const ctx = unifiedContext as unknown as WorkflowContext;

      const deriveOptions = {
        trigger: ctx.trigger,
        ctx,
        octokit,
        owner,
        repo,
        projectNumber,
        maxRetries: 5,
        botUsername: "nopo-bot",
      };

      const deriveResult = useNewMachine
        ? await IssueNextInvoke.deriveFromWorkflow(deriveOptions)
        : await deriveIssueActions(deriveOptions);

      if (deriveResult) {
        const result = useNewMachine
          ? predictExpectedStateNew(deriveResult)
          : predictExpectedState(deriveResult);
        if (result) {
          expectedStateJson = result;
        }

        // Serialize DeriveResult for sm-run (strip machineContext — it's large
        // and not needed for execution, only for derivation).
        const { machineContext: _mc, ...serializableResult } = deriveResult;
        deriveResultJson = JSON.stringify(serializableResult);

        // Write "⏳ running..." history entry early for instant feedback.
        // sm-run's logRunEnd replaces this with the actual outcome.
        await logRunStart(octokit, owner, repo, deriveResult);
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
    derive_result_json: deriveResultJson,
  });
}

run().catch((err) => {
  process.exitCode = 1;
  throw err;
});
